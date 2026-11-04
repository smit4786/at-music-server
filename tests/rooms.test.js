import { createRoomStore, selectSource, RoomError, ROOM_STALE_MS } from '../src/services/rooms.js';

// Deterministic clock: the store never reads the wall clock in these tests.
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// A resolved-track snapshot in the exact shape resolveMusicLink returns:
// Spotify primary (sdk full route + native preview) with a Deezer alternate
// (embed full route + preview audio).
function snap(overrides = {}) {
  return {
    provider: 'spotify', type: 'track', id: 'AAA', name: 'Song A', artist: 'Artist A',
    album: 'Album A', isrc: 'ISRC001', url: 'https://open.spotify.com/track/AAA',
    image: null, durationMs: 200000,
    audio: { kind: 'preview', url: 'https://cdn/spotify-preview.mp3', durationSec: 30, source: 'spotify', via: 'native' },
    playback: { method: 'sdk', sdk: { service: 'spotify', trackId: 'AAA', uri: 'spotify:track:AAA' }, requiresSubscription: true },
    crossLinks: {}, embedUrl: null,
    alternates: [
      {
        provider: 'deezer', id: '42', url: 'https://www.deezer.com/track/42',
        audio: { kind: 'preview', url: 'https://cdn/deezer-preview.mp3', durationSec: 30, source: 'deezer', via: 'alternate-search' },
        playback: { method: 'embed', embedUrl: 'https://widget.deezer.com/widget/dark/track/42', requiresSubscription: false },
        match: { confidence: 1, verifiedBy: 'isrc', basis: ['isrc'] },
      },
    ],
    matchSummary: null,
    ...overrides,
  };
}

function setup() {
  const clock = fakeClock();
  const store = createRoomStore({ now: clock.now });
  const room = store.createRoom('host-1');
  return { clock, store, roomId: room.id };
}

describe('room lifecycle', () => {
  test('createRoom: 6-char code, host is first member, paused at 0, empty queue', () => {
    const { store } = setup();
    const room = store.createRoom('host-9');
    expect(room.id).toMatch(/^[A-Z2-9]{6}$/);
    expect(room.hostId).toBe('host-9');
    expect(room.members).toEqual([{ userId: 'host-9', preferredService: null, isHost: true }]);
    expect(room.transport).toEqual({ status: 'paused', positionMs: 0 });
    expect(room.currentTrack).toBeNull();
    expect(room.currentIndex).toBe(0);
    expect(room.yourSource).toBeNull();
    expect(typeof room.serverTime).toBe('number');
  });

  test('joinRoom adds a member; unknown room throws 404 ROOM_NOT_FOUND', () => {
    const { store, roomId } = setup();
    const state = store.joinRoom(roomId, 'user-b', { preferredService: 'deezer' });
    expect(state.members.map((m) => m.userId)).toEqual(['host-1', 'user-b']);
    expect(state.members[1].preferredService).toBe('deezer');
    expect(() => store.joinRoom('ZZZZZZ', 'user-x')).toThrowError(
      expect.objectContaining({ code: 'ROOM_NOT_FOUND', status: 404 }),
    );
  });

  test('getState registers the caller as a member and updates their preference', () => {
    const { store, roomId } = setup();
    const state = store.getState(roomId, 'walk-in', { preferredService: 'spotify' });
    expect(state.members.map((m) => m.userId)).toContain('walk-in');
    const again = store.getState(roomId, 'walk-in', { preferredService: 'deezer' });
    expect(again.members.find((m) => m.userId === 'walk-in').preferredService).toBe('deezer');
  });

  test('rooms expire after 12h of inactivity, swept lazily', () => {
    const { clock, store, roomId } = setup();
    clock.advance(ROOM_STALE_MS + 1000);
    expect(store.expireStaleRooms()).toBe(1);
    expect(() => store.getState(roomId, 'host-1')).toThrowError(
      expect.objectContaining({ code: 'ROOM_NOT_FOUND' }),
    );
  });

  test('activity keeps a room alive past 12h of wall time', () => {
    const { clock, store, roomId } = setup();
    clock.advance(6 * 60 * 60 * 1000);
    store.getState(roomId, 'host-1'); // touches lastActivityAt
    clock.advance(6 * 60 * 60 * 1000);
    expect(store.getState(roomId, 'host-1').id).toBe(roomId);
  });
});

describe('queue', () => {
  test('members add tracks; order and current track are stable', () => {
    const { store, roomId } = setup();
    store.joinRoom(roomId, 'user-b');
    let state = store.addToQueue(roomId, 'host-1', snap());
    state = store.addToQueue(roomId, 'user-b', snap({ id: 'BBB', name: 'Song B' }));
    expect(state.queue.map((q) => q.name)).toEqual(['Song A', 'Song B']);
    expect(state.queue[1].queuedBy).toBe('user-b');
    expect(state.currentIndex).toBe(0);
    expect(state.currentTrack.name).toBe('Song A');
  });

  test('non-members cannot add to the queue (403 NOT_A_MEMBER)', () => {
    const { store, roomId } = setup();
    expect(() => store.addToQueue(roomId, 'stranger', snap())).toThrowError(
      expect.objectContaining({ code: 'NOT_A_MEMBER', status: 403 }),
    );
  });
});

describe('transport state machine', () => {
  test('play advances position with the clock; pause freezes it', () => {
    const { clock, store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap());
    store.control(roomId, 'host-1', 'play');
    clock.advance(5000);
    expect(store.getState(roomId, 'host-1').transport.positionMs).toBe(5000);
    store.control(roomId, 'host-1', 'pause');
    clock.advance(10000);
    const state = store.getState(roomId, 'host-1');
    expect(state.transport.status).toBe('paused');
    expect(state.transport.positionMs).toBe(5000);
  });

  test('seek sets position, clamps to duration, play resumes from there', () => {
    const { clock, store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap()); // durationMs 200000
    let state = store.control(roomId, 'host-1', 'seek', { positionMs: 60000 });
    expect(state.transport.positionMs).toBe(60000);
    state = store.control(roomId, 'host-1', 'seek', { positionMs: 999999 });
    expect(state.transport.positionMs).toBe(200000); // clamped
    store.control(roomId, 'host-1', 'seek', { positionMs: 60000 });
    store.control(roomId, 'host-1', 'play');
    clock.advance(2000);
    expect(store.getState(roomId, 'host-1').transport.positionMs).toBe(62000);
  });

  test('skip moves to the next track at position 0', () => {
    const { clock, store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap());
    store.addToQueue(roomId, 'host-1', snap({ id: 'BBB', name: 'Song B' }));
    store.control(roomId, 'host-1', 'play');
    clock.advance(3000);
    const state = store.control(roomId, 'host-1', 'skip');
    expect(state.currentIndex).toBe(1);
    expect(state.currentTrack.name).toBe('Song B');
    expect(state.transport.positionMs).toBe(0);
    expect(state.transport.status).toBe('playing');
  });

  test('back restarts the track when >3s in, otherwise goes to the previous track', () => {
    const { clock, store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap());
    store.addToQueue(roomId, 'host-1', snap({ id: 'BBB', name: 'Song B' }));
    store.control(roomId, 'host-1', 'seek', { positionMs: 60000 });
    let state = store.control(roomId, 'host-1', 'back');
    expect(state.currentIndex).toBe(0);
    expect(state.transport.positionMs).toBe(0);
    store.control(roomId, 'host-1', 'skip');
    store.control(roomId, 'host-1', 'play');
    clock.advance(1000); // 1s into track 2 — under the restart threshold
    state = store.control(roomId, 'host-1', 'back');
    expect(state.currentIndex).toBe(0);
    expect(state.transport.positionMs).toBe(0);
  });

  test('auto-advance carries the remainder into the next track; end of queue pauses clamped', () => {
    const { clock, store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap({ durationMs: 10000 }));
    store.addToQueue(roomId, 'host-1', snap({ id: 'BBB', name: 'Song B', durationMs: 20000 }));
    store.control(roomId, 'host-1', 'play');
    clock.advance(12000); // 2s past the end of track 1
    let state = store.getState(roomId, 'host-1');
    expect(state.currentIndex).toBe(1);
    expect(state.transport.positionMs).toBe(2000);
    expect(state.transport.status).toBe('playing');
    clock.advance(19000); // 21s into a 20s track, nothing after it
    state = store.getState(roomId, 'host-1');
    expect(state.currentIndex).toBe(1);
    expect(state.transport.status).toBe('paused');
    expect(state.transport.positionMs).toBe(20000);
  });

  test('tracks with unknown duration never auto-advance', () => {
    const { clock, store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap({ durationMs: null }));
    store.control(roomId, 'host-1', 'play');
    clock.advance(60 * 60 * 1000);
    const state = store.getState(roomId, 'host-1');
    expect(state.currentIndex).toBe(0);
    expect(state.transport.status).toBe('playing');
  });

  test('control is host-only: member attempts throw 403 NOT_HOST', () => {
    const { store, roomId } = setup();
    store.joinRoom(roomId, 'user-b');
    store.addToQueue(roomId, 'host-1', snap());
    for (const action of ['play', 'pause', 'skip', 'back']) {
      expect(() => store.control(roomId, 'user-b', action)).toThrowError(
        expect.objectContaining({ code: 'NOT_HOST', status: 403 }),
      );
    }
    expect(() => store.control(roomId, 'user-b', 'seek', { positionMs: 1 })).toThrow(RoomError);
  });

  test('play on an empty queue and unknown actions are validation errors', () => {
    const { store, roomId } = setup();
    expect(() => store.control(roomId, 'host-1', 'play')).toThrowError(
      expect.objectContaining({ code: 'EMPTY_QUEUE' }),
    );
    store.addToQueue(roomId, 'host-1', snap());
    expect(() => store.control(roomId, 'host-1', 'shuffle')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});

describe('yourSource selection', () => {
  test('member preferring deezer gets the deezer alternate (embed = full route, no fallback)', () => {
    const { store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap());
    const state = store.getState(roomId, 'host-1', { preferredService: 'deezer' });
    expect(state.yourSource.provider).toBe('deezer');
    expect(state.yourSource.via).toBe('alternate');
    expect(state.yourSource.audio.url).toBe('https://cdn/deezer-preview.mp3');
    expect(state.yourSource.playback.method).toBe('embed');
    expect(state.yourSource.fallbackUsed).toBe(false);
  });

  test('member with no preference gets the primary route', () => {
    const { store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', snap());
    const state = store.getState(roomId, 'user-b'); // registers with no preference
    expect(state.yourSource.provider).toBe('spotify');
    expect(state.yourSource.via).toBe('primary');
    expect(state.yourSource.playback.method).toBe('sdk');
    expect(state.yourSource.fallbackUsed).toBe(false);
  });

  test('preference for a service with no alternate falls back to primary', () => {
    const src = selectSource(snap(), 'tidal');
    expect(src.via).toBe('primary');
    expect(src.provider).toBe('spotify');
  });

  test('preview-only route is flagged fallbackUsed', () => {
    const previewOnly = snap({
      provider: 'tidal',
      audio: { kind: 'preview', url: 'https://cdn/x-preview.mp3', durationSec: 30, source: 'deezer', via: 'isrc-cross-match' },
      playback: { method: 'preview', streamUrl: 'https://cdn/x-preview.mp3', requiresSubscription: false },
      alternates: [],
    });
    const src = selectSource(previewOnly, null);
    expect(src.fallbackUsed).toBe(true);
    // and in-room:
    const { store, roomId } = setup();
    store.addToQueue(roomId, 'host-1', previewOnly);
    expect(store.getState(roomId, 'host-1').yourSource.fallbackUsed).toBe(true);
  });

  test('full direct stream is not a fallback', () => {
    const full = snap({
      provider: 'audius',
      audio: { kind: 'full', url: 'https://audius/stream', durationSec: 200, source: 'audius', via: 'native' },
      playback: { method: 'stream', streamUrl: 'https://audius/stream', requiresSubscription: false },
      alternates: [],
    });
    expect(selectSource(full, null).fallbackUsed).toBe(false);
  });

  test('no current track → yourSource is null', () => {
    expect(selectSource(null, 'deezer')).toBeNull();
  });
});
