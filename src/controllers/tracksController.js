import { getProvider } from '../services/providers/index.js';

// Legacy controller — delegates to the LastFmProvider via the registry.
// New integrations should use /api/v1/music/* instead.
function lastfm() { return getProvider('lastfm'); }

export const getRecentTracks = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Missing username parameter' });
    }

    const tracks = await lastfm().getRecentTracks(
      username,
      { page: parseInt(page), limit: parseInt(limit) }
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

    const userInfo = await lastfm().getUserInfo(username);

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

    const artists = await lastfm().getTopArtists(
      username,
      { period, limit: parseInt(limit) }
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

    const tracks = await lastfm().searchTracks(query, { limit: parseInt(limit) });

    res.json({
      tracks,
      query,
      limit: parseInt(limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const loveTrack = async (req, res) => {
  try {
    const { username } = req.body;
    const { track, artist } = req.body;

    if (!username || !track || !artist) {
      return res.status(400).json({ error: 'Missing username, track, or artist parameter' });
    }

    const result = await lastfm().loveTrack(username, track, artist);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const unloveTrack = async (req, res) => {
  try {
    const { username } = req.body;
    const { track, artist } = req.body;

    if (!username || !track || !artist) {
      return res.status(400).json({ error: 'Missing username, track, or artist parameter' });
    }

    const result = await lastfm().unloveTrack(username, track, artist);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
