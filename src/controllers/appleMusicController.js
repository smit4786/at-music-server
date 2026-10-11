import AppleMusicService from '../services/appleMusicService.js';

export const searchCatalog = async (req, res) => {
  try {
    const { term, types, limit, storefront } = req.query;
    if (!term) return res.status(400).json({ error: 'Missing term parameter' });
    const results = await AppleMusicService.searchCatalog(term, types, limit, storefront);
    res.json(results);
  } catch (error) {
    res.status(502).json({ error: 'Apple Music catalog search failed', detail: error.message });
  }
};

export const lookupByIsrc = async (req, res) => {
  try {
    const { isrc } = req.params;
    const { storefront } = req.query;
    if (!isrc) return res.status(400).json({ error: 'Missing ISRC parameter' });
    const songs = await AppleMusicService.lookupByIsrc(isrc, storefront);
    res.json(songs);
  } catch (error) {
    res.status(502).json({ error: 'Apple Music ISRC lookup failed', detail: error.message });
  }
};

export const getLibraryTracks = async (req, res) => {
  try {
    const userToken = req.headers['music-user-token'];
    if (!userToken) return res.status(401).json({ error: 'Missing Music-User-Token header' });
    const { limit, offset } = req.query;
    const tracks = await AppleMusicService.getLibraryTracks(userToken, limit, offset);
    res.json(tracks);
  } catch (error) {
    res.status(502).json({ error: 'Apple Music library read failed', detail: error.message });
  }
};

export const getLibraryPlaylists = async (req, res) => {
  try {
    const userToken = req.headers['music-user-token'];
    if (!userToken) return res.status(401).json({ error: 'Missing Music-User-Token header' });
    const { limit, offset } = req.query;
    const playlists = await AppleMusicService.getLibraryPlaylists(userToken, limit, offset);
    res.json(playlists);
  } catch (error) {
    res.status(502).json({ error: 'Apple Music playlist read failed', detail: error.message });
  }
};

export const createPlaylist = async (req, res) => {
  try {
    const userToken = req.headers['music-user-token'];
    if (!userToken) return res.status(401).json({ error: 'Missing Music-User-Token header' });
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing playlist name' });
    const playlists = await AppleMusicService.createPlaylist(userToken, name, description);
    res.status(201).json(playlists);
  } catch (error) {
    res.status(502).json({ error: 'Apple Music playlist creation failed', detail: error.message });
  }
};

export const addToPlaylist = async (req, res) => {
  try {
    const userToken = req.headers['music-user-token'];
    if (!userToken) return res.status(401).json({ error: 'Missing Music-User-Token header' });
    const { playlistId } = req.params;
    const { songIds } = req.body;
    if (!playlistId || !Array.isArray(songIds)) {
      return res.status(400).json({ error: 'Missing playlistId or songIds array' });
    }
    const result = await AppleMusicService.addToPlaylist(userToken, playlistId, songIds);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: 'Apple Music playlist update failed', detail: error.message });
  }
};
