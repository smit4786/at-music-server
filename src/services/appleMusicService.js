import axios from 'axios';
import config from '../config/config.js';
import { cache } from '../config/redis.js';

const appleMusicClient = axios.create({
  baseURL: 'https://amp-api.music.apple.com/v1',
  timeout: 10000,
});

function headers(userToken) {
  const h = {
    'Authorization': `Bearer ${config.appleMusicDeveloperToken}`,
    'Origin': 'https://music.apple.com',
  };
  if (userToken) h['Music-User-Token'] = userToken;
  return h;
}

export class AppleMusicService {
  // Catalog search — no user token required.
  static async searchCatalog(term, types = 'songs,albums,artists', limit = 10, storefront = 'us') {
    const cacheKey = `am:search:${storefront}:${types}:${limit}:${term}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const response = await appleMusicClient.get(
      `/catalog/${storefront}/search`,
      { headers: headers(), params: { term, types, limit } }
    );
    const results = response.data.results || {};
    await cache.set(cacheKey, results, 3600);
    return results;
  }

  // ISRC lookup — cross-service identity key for Spotify/Last.fm matching.
  static async lookupByIsrc(isrc, storefront = 'us') {
    const cacheKey = `am:isrc:${storefront}:${isrc}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const response = await appleMusicClient.get(
      `/catalog/${storefront}/songs`,
      { headers: headers(), params: { 'filter[isrc]': isrc } }
    );
    const songs = response.data.data || [];
    await cache.set(cacheKey, songs, 86400);
    return songs;
  }

  // Library — requires the user's Music-User-Token.
  static async getLibraryTracks(userToken, limit = 50, offset = 0) {
    const response = await appleMusicClient.get('/me/library/songs', {
      headers: headers(userToken),
      params: { limit, offset },
    });
    return response.data.data || [];
  }

  static async getLibraryPlaylists(userToken, limit = 50, offset = 0) {
    const response = await appleMusicClient.get('/me/library/playlists', {
      headers: headers(userToken),
      params: { limit, offset },
    });
    return response.data.data || [];
  }

  static async createPlaylist(userToken, name, description = '') {
    const response = await appleMusicClient.post('/me/library/playlists',
      { attributes: { name, description } },
      { headers: headers(userToken) }
    );
    return response.data.data || [];
  }

  static async addToPlaylist(userToken, playlistId, songIds) {
    const response = await appleMusicClient.post(
      `/me/library/playlists/${playlistId}/tracks`,
      { data: songIds.map(id => ({ id, type: 'songs' })) },
      { headers: headers(userToken) }
    );
    return response.data;
  }
}

export default AppleMusicService;
