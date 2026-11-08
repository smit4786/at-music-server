import express from 'express';
import { authenticateUser } from '../middleware/auth.js';
import { trackLimiter } from '../middleware/rateLimiter.js';
import { resolveMusicLink } from '../services/linkResolver.js';
import { roomStore, RoomError } from '../services/rooms.js';

const router = express.Router();

router.use(authenticateUser);

// Standardized envelope: { success, data } or { success: false, error: { message, code } }
function ok(res, data) { return res.json({ success: true, data }); }
function fail(res, status, message, code = 'PROVIDER_ERROR') {
  return res.status(status).json({ success: false, error: { message, code } });
}

function handleError(res, e) {
  if (e instanceof RoomError) return fail(res, e.status, e.message, e.code);
  if (e.code === 'VALIDATION_ERROR') return fail(res, 400, e.message, 'VALIDATION_ERROR');
  if (e.code === 'UNSUPPORTED_LINK') return fail(res, 400, e.message, 'UNSUPPORTED_LINK');
  return fail(res, 502, e.message, e.code || 'UPSTREAM_ERROR');
}

// Create a room — the creator is the host (and first member).
// POST /api/v1/rooms { preferredService? }
router.post('/', (req, res) => {
  try {
    const state = roomStore.createRoom(req.user.userId, {
      preferredService: req.body?.preferredService,
    });
    res.status(201).json({ success: true, data: state });
  } catch (e) {
    handleError(res, e);
  }
});

// Join a room by its code. Idempotent; updates preferredService when given.
// POST /api/v1/rooms/:id/join { preferredService? }
router.post('/:id/join', (req, res) => {
  try {
    ok(res, roomStore.joinRoom(req.params.id, req.user.userId, {
      preferredService: req.body?.preferredService,
    }));
  } catch (e) {
    handleError(res, e);
  }
});

// Room state for the caller. Reading state registers/updates the caller as
// a member and applies ?service= as their preferred service. The response
// includes `transport.positionMs` (server-authoritative), `serverTime` for
// drift correction, and `yourSource` — the route THIS member should play
// (their service's alternate when the snapshot has one, else the primary),
// with `fallbackUsed` flagging a preview-only route.
// GET /api/v1/rooms/:id/state?service=deezer
router.get('/:id/state', (req, res) => {
  try {
    ok(res, roomStore.getState(req.params.id, req.user.userId, {
      preferredService: req.query.service,
    }));
  } catch (e) {
    handleError(res, e);
  }
});

// Add a track to the queue by link (any member). The link is resolved via
// the universal resolver and the full snapshot (metadata + audio + playback
// + per-service alternates) is stored, so every member's client can pick
// its own source from the same snapshot.
// POST /api/v1/rooms/:id/queue { url }
router.post('/:id/queue', trackLimiter, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return fail(res, 400, 'Missing url in request body', 'VALIDATION_ERROR');
  try {
    const snapshot = await resolveMusicLink(url);
    ok(res, roomStore.addToQueue(req.params.id, req.user.userId, snapshot));
  } catch (e) {
    handleError(res, e);
  }
});

// Transport control — HOST ONLY (403 NOT_HOST otherwise).
// POST /api/v1/rooms/:id/control { action: 'play'|'pause'|'seek'|'skip'|'back', positionMs? }
router.post('/:id/control', (req, res) => {
  const { action, positionMs } = req.body || {};
  if (!action) return fail(res, 400, 'Missing action in request body', 'VALIDATION_ERROR');
  try {
    ok(res, roomStore.control(req.params.id, req.user.userId, action, { positionMs }));
  } catch (e) {
    handleError(res, e);
  }
});

// Live state stream (Server-Sent Events). Sends the caller's full state on
// connect and again on every room mutation (join / queue / control /
// auto-advance). Each subscriber receives state computed for THEMSELVES
// (their own yourSource). 25s heartbeat comments keep proxies from
// idling the connection out.
// GET /api/v1/rooms/:id/events?service=deezer
router.get('/:id/events', (req, res) => {
  const userId = req.user.userId;
  let initial;
  try {
    initial = roomStore.getState(req.params.id, userId, {
      preferredService: req.query.service,
    });
  } catch (e) {
    return handleError(res, e);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // ask reverse proxies not to buffer the stream
  });

  const send = (state) => {
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  };
  send(initial);

  const unsubscribe = roomStore.subscribe(req.params.id, () => {
    try {
      send(roomStore.getState(req.params.id, userId));
    } catch {
      // Room expired mid-stream: close quietly; the client can rejoin.
      cleanup();
      res.end();
    }
  });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
});

export default router;
