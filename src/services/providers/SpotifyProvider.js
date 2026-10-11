import axios from 'axios';
import config from '../config/config.js';
import { cache } from '../config/redis.js';
import { MusicProvider, normalizeTrack } from './MusicProvider.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const credentials = Buffer.from(
    `${config.spotifyClientId}:${config.spotifyClientSecret}`
  ).toString('base64');
  const response = await axios.post(TOKEN_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  tokenCache = {
    token: response.data.access_token,
    expiresAt: Date.now() + (response.data.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

async function spotifyGet(path, params = {}) {
  const token = await getAccessToken();
  const response = await axios.get(`${API_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    params,
    timeout: 10000,
  });
  return response.data;
}

function spotifyTrackToNormalized(t) {
  return normalizeTrack({
    id: t.id,
    name: t.name,
    artist: t.artists?.map(a => a.name).join(', '),
    album: t.album?.name,
    isrc: t.external_ids?.isrc,
    url: t.external_urls?.spotify,
    artwork: t.album?.images?.[0] ? { url: t.album.images[0].url } : null,
  });
}

export class SpotifyProvider extends MusicProvider {
  constructor() { super('spotify'); }

  async searchTracks(term, { limit = 10 } = {}) {
    const cacheKey = `spotify:search:${limit}:${term}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    const data = await spotifyGet('/search', { q: term, type: 'track', limit });
    const tracks = (data.tracks?.items || []).map(spotifyTrackToNormalized);
    await cache.set(cacheKey, tracks, 3600);
    return tracks;
  }

  async getRecentTracks() {
    // Requires user OAuth scope (user-read-recently-played); not available with client credentials.
    return [];
  }

  async getTopArtists() {
    // Requires user OAuth scope (user-top-read); not available with client credentials.
    return [];
  }

  async lookupByIsrc(isrc) {
    const cacheKey = `spotify:isrc:${isrc}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    const data = await spotifyGet('/search', { q: `isrc:${isrc}`, type: 'track', limit: 5 });
    const tracks = (data.tracks?.items || []).map(spotifyTrackToNormalized);
    await cache.set(cacheKey, tracks, 86400);
    return tracks;
  }
}

export default SpotifyProvider;
