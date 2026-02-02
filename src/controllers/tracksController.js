import LastFMService from '../services/lastfmService.js';

export const getRecentTracks = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Missing username parameter' });
    }
    
    const tracks = await LastFMService.getRecentTracks(
      username,
      parseInt(page),
      parseInt(limit)
    );
    
    res.json({
      tracks,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getUserInfo = async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Missing username parameter' });
    }
    
    const userInfo = await LastFMService.getUserInfo(username);
    
    res.json(userInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getTopArtists = async (req, res) => {
  try {
    const { username } = req.body;
    const { period = '7day', limit = 10 } = req.query;
    
    if (!username) {
      return res.status(400).json({ error: 'Missing username parameter' });
    }
    
    const artists = await LastFMService.getTopArtists(
      username,
      period,
      parseInt(limit)
    );
    
    res.json({
      artists,
      period,
      limit: parseInt(limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const searchTracks = async (req, res) => {
  try {
    const { query } = req.query;
    const { limit = 20 } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }
    
    const tracks = await LastFMService.searchTracks(query, parseInt(limit));
    
    res.json({
      query,
      tracks,
      limit: parseInt(limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const loveTrack = async (req, res) => {
  try {
    const { artist, track } = req.body;
    const { username } = req.body;

    if (!artist || !track || !username) {
      return res.status(400).json({
        error: 'Missing required fields: artist, track, username',
      });
    }

    // Get user's API key from decoded token context
    // In production, store user data in database
    const result = await LastFMService.loveTrack(
      username,
      artist,
      track,
      process.env.LASTFM_API_KEY
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const unloveTrack = async (req, res) => {
  try {
    const { artist, track } = req.body;
    const { username } = req.body;

    if (!artist || !track || !username) {
      return res.status(400).json({
        error: 'Missing required fields: artist, track, username',
      });
    }

    const result = await LastFMService.unloveTrack(
      username,
      artist,
      track,
      process.env.LASTFM_API_KEY
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export default {
  getRecentTracks,
  getUserInfo,
  getTopArtists,
  searchTracks,
  loveTrack,
  unloveTrack,
};
