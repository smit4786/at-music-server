import axios from 'axios';
import config from '../config/config.js';
import { cache } from '../config/redis.js';
import { MusicProvider, normalizeTrack } from './MusicProvider.js';

const lastfmClient = axios.create({
  baseURL: config.lastfmApiUrl,
  timeout: 10000,
});

async function lastfmCall(method, params) {
  const response = await lastfmClient.get('/', {
    params: { method, api_key: config.lastfmApiKey, format: 'json', ...params },
  });
  if (response.data.error) {
    throw new Error(`Last.fm error: ${response.data.message}`);
  }
  return response.data;
}

export class LastFmProvider extends MusicProvider {
  constructor() { super('lastfm'); }

  async searchTracks(term, { limit = 10 } = {}) {
    const data = await lastfmCall('track.search', { track: term, limit });
    const tracks = data.results?.trackmatches?.track || [];
    return tracks.map(normalizeTrack);
  }

  async getRecentTracks(username, { page = 1, limit = 50 } = {}) {
    const cacheKey = `lastfm:tracks:${username}:${page}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    const data = await lastfmCall('user.getrecenttracks', { user: username, page, limit });
    const tracks = (data.recenttracks?.track || []).map(normalizeTrack);
    await cache.set(cacheKey, tracks, 300);
    return tracks;
  }

  async getTopArtists(username, { period = '7day', limit = 10 } = {}) {
    const data = await lastfmCall('user.gettopartists', { user: username, period, limit });
    return data.topartists?.artist || [];
  }

  async getUserInfo(username) {
    const cacheKey = `lastfm:user:${username}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    const data = await lastfmCall('user.getinfo', { user: username });
    const user = data.user || {};
    await cache.set(cacheKey, user, 3600);
    return user;
  }

  async loveTrack(username, track, artist) {
    // Requires authenticated session; placeholder for signed API calls.
    throw new Error('loveTrack requires a signed Last.fm session (not yet implemented)');
  }

  async unloveTrack(username, track, artist) {
    throw new Error('unloveTrack requires a signed Last.fm session (not yet implemented)');
  }

  async lookupByIsrc() {
    // Last.fm has no ISRC lookup; cross-reference via Apple Music provider.
    return [];
  }
}

export default LastFmProvider;
