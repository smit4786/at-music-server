// rooms — listen-along room store + transport state machine.
//
// The server conducts; it never serves audio. A room owns a queue of
// resolved-track snapshots (the exact objects resolveMusicLink returns) and
// a transport clock. Every member's client plays the current track from its
// OWN source — its preferred service's alternate when the snapshot has one,
// else the primary route — while this module is the single authority on
// "what is playing and at what position".
//
// Storage is an in-memory Map: rooms are ephemeral by design (12h stale
// expiry, swept lazily on access). If rooms ever need to survive restarts
// or span multiple processes, the Map below is the seam — swap it for the
// Redis client in src/config/redis.js behind this same function surface.
//
// The store is a factory with an injectable clock (`now`) so the transport
// math is unit-testable without real timers. Routes use the default
// exported instance (`roomStore`).

import { randomInt } from 'node:crypto';

export const ROOM_STALE_MS = 12 * 60 * 60 * 1000; // 12h of inactivity
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const CODE_LENGTH = 6;
const BACK_RESTART_THRESHOLD_MS = 3000; // "back" restarts the track past this

export class RoomError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function roomNotFound(id) {
  return new RoomError(`Room not found: ${id}`, 'ROOM_NOT_FOUND', 404);
}

// Playback routes that deliver the FULL track (see linkResolver's ladder:
// stream = direct full audio, sdk = full playback under the member's own
// subscription, embed = the service's official full-length player).
const FULL_ROUTE_METHODS = new Set(['stream', 'sdk', 'embed']);

// Pick the source one member should play for a queue snapshot: the
// alternate matching their preferred service when present, else the
// primary resolved route. `fallbackUsed` is the honesty flag — true when
// the member's best route is only a preview (or nothing), i.e. they are
// NOT hearing the full track while others in the room may be.
export function selectSource(snapshot, preferredService) {
  if (!snapshot) return null;
  let via = 'primary';
  let provider = snapshot.provider;
  let audio = snapshot.audio ?? null;
  let playback = snapshot.playback ?? null;
  if (preferredService && preferredService !== snapshot.provider) {
    const alt = (snapshot.alternates || []).find((a) => a.provider === preferredService);
    if (alt) {
      via = 'alternate';
      provider = alt.provider;
      audio = alt.audio ?? null;
      playback = alt.playback ?? null;
    }
  }
  const fullRoute = (playback && FULL_ROUTE_METHODS.has(playback.method))
    || (!playback && audio && audio.kind === 'full');
  return { provider, via, audio, playback, fallbackUsed: !fullRoute };
}

export function createRoomStore({ now = () => Date.now() } = {}) {
  const rooms = new Map(); // id -> room
  const listeners = new Map(); // id -> Set<fn(roomId)>

  function emit(room) {
    const subs = listeners.get(room.id);
    if (!subs) return;
    for (const fn of [...subs]) {
      try { fn(room.id); } catch { /* a dead SSE listener must not break mutations */ }
    }
  }

  function sweep() {
    const t = now();
    for (const [id, room] of rooms) {
      if (t - room.lastActivityAt > ROOM_STALE_MS) {
        rooms.delete(id);
        listeners.delete(id);
      }
    }
  }

  function live(id, { touch = true } = {}) {
    sweep();
    const room = rooms.get(id);
    if (!room) throw roomNotFound(id);
    if (touch) room.lastActivityAt = now();
    return room;
  }

  function genCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
    throw new RoomError('Could not allocate a room code', 'ROOM_CODE_EXHAUSTED', 500);
  }

  function ensureMember(room, userId, preferredService) {
    let member = room.members.find((m) => m.userId === userId);
    if (!member) {
      member = { userId, preferredService: preferredService || null };
      room.members.push(member);
    } else if (preferredService) {
      member.preferredService = preferredService;
    }
    return member;
  }

  function currentTrack(room) {
    return room.queue[room.currentIndex] || null;
  }

  function positionMs(room) {
    const t = room.transport;
    const pos = t.basePositionMs + (t.status === 'playing' ? now() - t.startedAt : 0);
    return Math.max(0, Math.floor(pos));
  }

  // Lazy auto-advance: when the computed position runs past the current
  // track's known duration, carry the remainder into the next track (a
  // room left playing overnight walks its queue instead of wrapping one
  // track forever). Tracks with unknown duration never auto-advance.
  // Running out of queue pauses the transport, clamped at the last
  // track's end. Returns true when the index/status changed.
  function advanceIfNeeded(room) {
    let changed = false;
    let guard = 0;
    while (room.transport.status === 'playing' && guard++ < 10000) {
      const track = currentTrack(room);
      if (!track || !track.durationMs || track.durationMs <= 0) break;
      const pos = positionMs(room);
      if (pos < track.durationMs) break;
      changed = true;
      if (room.currentIndex >= room.queue.length - 1) {
        room.transport.status = 'paused';
        room.transport.basePositionMs = track.durationMs;
        room.transport.startedAt = null;
        break;
      }
      room.currentIndex += 1;
      room.transport.basePositionMs = pos - track.durationMs;
      room.transport.startedAt = now();
    }
    return changed;
  }

  function serialize(room, forUserId) {
    advanceIfNeeded(room);
    const member = room.members.find((m) => m.userId === forUserId) || null;
    const track = currentTrack(room);
    return {
      id: room.id,
      hostId: room.hostId,
      createdAt: room.createdAt,
      lastActivityAt: room.lastActivityAt,
      members: room.members.map((m) => ({
        userId: m.userId,
        preferredService: m.preferredService,
        isHost: m.userId === room.hostId,
      })),
      queue: room.queue.map((s, i) => ({
        index: i,
        name: s.name || '',
        artist: s.artist || '',
        provider: s.provider,
        durationMs: s.durationMs ?? null,
        queuedBy: s.queuedBy || null,
      })),
      currentIndex: room.currentIndex,
      currentTrack: track,
      transport: {
        status: room.transport.status,
        positionMs: positionMs(room),
      },
      serverTime: now(),
      yourSource: selectSource(track, member?.preferredService),
    };
  }

  return {
    createRoom(hostId, { preferredService } = {}) {
      sweep();
      const t = now();
      const room = {
        id: genCode(),
        hostId,
        members: [],
        queue: [],
        currentIndex: 0,
        transport: { status: 'paused', startedAt: null, basePositionMs: 0 },
        createdAt: t,
        lastActivityAt: t,
      };
      rooms.set(room.id, room);
      ensureMember(room, hostId, preferredService);
      emit(room);
      return serialize(room, hostId);
    },

    joinRoom(id, userId, { preferredService } = {}) {
      const room = live(id);
      const isNew = !room.members.some((m) => m.userId === userId);
      ensureMember(room, userId, preferredService);
      if (isNew) emit(room);
      return serialize(room, userId);
    },

    addToQueue(id, userId, snapshot) {
      const room = live(id);
      if (!room.members.some((m) => m.userId === userId)) {
        throw new RoomError('Only room members can add to the queue', 'NOT_A_MEMBER', 403);
      }
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.provider) {
        throw new RoomError('Invalid resolved track snapshot', 'VALIDATION_ERROR');
      }
      room.queue.push({ ...snapshot, queuedBy: userId, queuedAt: now() });
      emit(room);
      return serialize(room, userId);
    },

    control(id, userId, action, { positionMs: seekTo } = {}) {
      const room = live(id);
      if (room.hostId !== userId) {
        throw new RoomError('Only the host can control playback', 'NOT_HOST', 403);
      }
      advanceIfNeeded(room);
      const t = room.transport;
      const track = currentTrack(room);
      switch (action) {
        case 'play': {
          if (!track) throw new RoomError('Queue is empty', 'EMPTY_QUEUE');
          if (t.status !== 'playing') {
            // Replaying a finished last track starts it over.
            if (track.durationMs && positionMs(room) >= track.durationMs) t.basePositionMs = 0;
            t.status = 'playing';
            t.startedAt = now();
          }
          break;
        }
        case 'pause': {
          if (t.status === 'playing') {
            t.basePositionMs = positionMs(room);
            t.startedAt = null;
            t.status = 'paused';
          }
          break;
        }
        case 'seek': {
          if (!track) throw new RoomError('Queue is empty', 'EMPTY_QUEUE');
          if (typeof seekTo !== 'number' || !Number.isFinite(seekTo) || seekTo < 0) {
            throw new RoomError('positionMs must be a non-negative number', 'VALIDATION_ERROR');
          }
          t.basePositionMs = track.durationMs ? Math.min(seekTo, track.durationMs) : seekTo;
          if (t.status === 'playing') t.startedAt = now();
          break;
        }
        case 'skip': {
          if (!track) throw new RoomError('Queue is empty', 'EMPTY_QUEUE');
          if (room.currentIndex < room.queue.length - 1) {
            room.currentIndex += 1;
            t.basePositionMs = 0;
          } else {
            // Nowhere to skip to: stop at the end of the last track.
            t.basePositionMs = track.durationMs ?? t.basePositionMs;
            t.status = 'paused';
          }
          if (t.status === 'playing') t.startedAt = now(); else t.startedAt = null;
          break;
        }
        case 'back': {
          if (!track) throw new RoomError('Queue is empty', 'EMPTY_QUEUE');
          if (positionMs(room) > BACK_RESTART_THRESHOLD_MS || room.currentIndex === 0) {
            t.basePositionMs = 0;
          } else {
            room.currentIndex -= 1;
            t.basePositionMs = 0;
          }
          if (t.status === 'playing') t.startedAt = now(); else t.startedAt = null;
          break;
        }
        default:
          throw new RoomError(`Unknown control action: ${action}`, 'VALIDATION_ERROR');
      }
      emit(room);
      return serialize(room, userId);
    },

    // Reading state registers/updates the caller as a member (a band mate
    // with the join code is in the room) and lazily advances the transport.
    getState(id, userId, { preferredService } = {}) {
      const room = live(id);
      ensureMember(room, userId, preferredService);
      if (advanceIfNeeded(room)) emit(room);
      return serialize(room, userId);
    },

    expireStaleRooms() {
      const before = rooms.size;
      sweep();
      return before - rooms.size;
    },

    subscribe(id, fn) {
      if (!rooms.has(id)) throw roomNotFound(id);
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(fn);
      return () => {
        listeners.get(id)?.delete(fn);
        if (listeners.get(id)?.size === 0) listeners.delete(id);
      };
    },

    hasRoom(id) {
      sweep();
      return rooms.has(id);
    },
  };
}

// Default instance used by the routes (real clock).
export const roomStore = createRoomStore();

export default roomStore;
