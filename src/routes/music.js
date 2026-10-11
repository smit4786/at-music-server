import express from 'express';
import { getProvider, listProviders } from '../services/providers/index.js';
import { AppleMusicProvider } from '../services/providers/AppleMusicProvider.js';
import { authenticateUser } from '../middleware/auth.js';
import { trackLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.use(authenticateUser);
router.use(trackLimiter);

// Standardized envelope: { success, data } or { success: false, error: { message, code } }
function ok(res, data) { return res.json({ success: true, data }); }
function fail(res, status, message, code = 'PROVIDER_ERROR') {
  return res.status(status).json({ success: false, error: { message, code } });
}

// List available providers
router.get('/providers', (req, res) => ok(res, listProviders()));

// Unified search across any registered provider
// GET /api/v1/music/search?provider=apple-music&term=...&limit=10
router.get('/search', async (req, res) => {
  try {
    const { provider = 'apple-music', term, limit, types, storefront } = req.query;
    if (!term) return fail(res, 400, 'Missing term parameter', 'VALIDATION_ERROR');
    const p = getProvider(provider);
    const tracks = await p.searchTracks(term, { limit: Number(limit) || 10, types, storefront });
    ok(res, tracks);
  } catch (e) {
    fail(res, e.message.startsWith('Unknown music provider') ? 400 : 502, e.message);
  }
});

// Unified recent tracks (provider must support it)
// GET /api/v1/music/recent?provider=lastfm&username=...&limit=50
router.get('/recent', async (req, res) => {
  try {
    const { provider = 'lastfm', username, page, limit } = req.query;
    if (!username) return fail(res, 400, 'Missing username parameter', 'VALIDATION_ERROR');
    const p = getProvider(provider);
    const tracks = await p.getRecentTracks(username, { page: Number(page) || 1, limit: Number(limit) || 50 });
    ok(res, tracks);
  } catch (e) {
    fail(res, 502, e.message);
  }
});

// ISRC cross-reference — resolves a track across services
// GET /api/v1/music/isrc/:isrc
router.get('/isrc/:isrc', async (req, res) => {
  try {
    const { isrc } = req.params;
    const { storefront } = req.query;
    const p = getProvider('apple-music');
    const tracks = await p.lookupByIsrc(isrc, { storefront });
    ok(res, tracks);
  } catch (e) {
    fail(res, 502, e.message);
  }
});

// Apple Music library (requires Music-User-Token header)
function requireUserToken(req, res) {
  const t = req.headers['music-user-token'];
  if (!t) { fail(res, 401, 'Missing Music-User-Token header', 'AUTH_ERROR'); return null; }
  return t;
}

router.get('/library/tracks', async (req, res) => {
  const token = requireUserToken(req, res);
  if (!token) return;
  try {
    const p = getProvider('apple-music');
    if (!(p instanceof AppleMusicProvider)) return fail(res, 400, 'Provider does not support library access');
    const tracks = await p.getLibraryTracks(token, req.query);
    ok(res, tracks);
  } catch (e) {
    fail(res, 502, e.message);
  }
});

router.get('/library/playlists', async (req, res) => {
  const token = requireUserToken(req, res);
  if (!token) return;
  try {
    const p = getProvider('apple-music');
    const playlists = await p.getLibraryPlaylists(token, req.query);
    ok(res, playlists);
  } catch (e) {
    fail(res, 502, e.message);
  }
});

router.post('/library/playlists', async (req, res) => {
  const token = requireUserToken(req, res);
  if (!token) return;
  try {
    const { name, description } = req.body;
    if (!name) return fail(res, 400, 'Missing playlist name', 'VALIDATION_ERROR');
    const p = getProvider('apple-music');
    const playlists = await p.createPlaylist(token, name, description);
    res.status(201).json({ success: true, data: playlists });
  } catch (e) {
    fail(res, 502, e.message);
  }
});

router.post('/library/playlists/:playlistId/tracks', async (req, res) => {
  const token = requireUserToken(req, res);
  if (!token) return;
  try {
    const { playlistId } = req.params;
    const { songIds } = req.body;
    if (!playlistId || !Array.isArray(songIds)) {
      return fail(res, 400, 'Missing playlistId or songIds array', 'VALIDATION_ERROR');
    }
    const p = getProvider('apple-music');
    const result = await p.addToPlaylist(token, playlistId, songIds);
    ok(res, result);
  } catch (e) {
    fail(res, 502, e.message);
  }
});

export default router;
