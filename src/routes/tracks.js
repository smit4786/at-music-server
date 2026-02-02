import express from 'express';
import {
  getRecentTracks,
  getUserInfo,
  getTopArtists,
  searchTracks,
  loveTrack,
  unloveTrack,
} from '../controllers/tracksController.js';
import { authenticateUser } from '../middleware/auth.js';
import { trackLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.use(authenticateUser);
router.use(trackLimiter);

router.post('/recent', getRecentTracks);
router.post('/info', getUserInfo);
router.get('/top-artists', getTopArtists);
router.get('/search', searchTracks);
router.post('/love', loveTrack);
router.post('/unlove', unloveTrack);

export default router;
