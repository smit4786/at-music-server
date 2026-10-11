import express from 'express';
import {
  searchCatalog,
  lookupByIsrc,
  getLibraryTracks,
  getLibraryPlaylists,
  createPlaylist,
  addToPlaylist,
} from '../controllers/appleMusicController.js';
import { authenticateUser } from '../middleware/auth.js';
import { trackLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.use(authenticateUser);
router.use(trackLimiter);

// Catalog (no user token required)
router.get('/search', searchCatalog);
router.get('/isrc/:isrc', lookupByIsrc);

// Library (requires Music-User-Token header)
router.get('/library/tracks', getLibraryTracks);
router.get('/library/playlists', getLibraryPlaylists);
router.post('/library/playlists', createPlaylist);
router.post('/library/playlists/:playlistId/tracks', addToPlaylist);

export default router;
