import axios from 'axios';
import config from '../config/config.js';
import { cache } from '../config/redis.js';
import { MusicProvider, normalizeTrack } from './MusicProvider.js';

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

function songToTrack(song) {
  const a = song.attributes || {};
  return normalizeTrack({
    id: song.id,
    name: a.name,
    artist: a.artistName,
    album: a.albumName,
    isrc: a.isrc,
    url: a.url,
    artwork: a.artwork,
  });
}

export class AppleMusicProvider extends MusicProvider {
  constructor() { super('apple-music'); }

  async searchTracks(term, { types = 'songs', limit = 10, storefront = 'us' } = {}) {
    const cacheKey = `am:search:${storefront}:${types}:${limit}:${term}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    const response = await appleMusicClient.get(`/catalog/${storefront}/search`, {
      headers: headers(), params: { term, types, limit },
    });
    const songs = response.data.results?.songs?.data || [];
    const tracks = songs.map(songToTrack);
    await cache.set(cacheKey, tracks, 3600);
    return tracks;
  }

  async getRecentTracks() {
    // Apple Music has no recent-tracks endpoint; use library heavy rotation instead.
    return [];
  }

  async getTopArtists() {
    return [];
  }

  async lookupByIsrc(isrc, { storefront = 'us' } = {}) {
    const cacheKey = `am:isrc:${storefront}:${isrc}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    const response = await appleMusicClient.get(`/catalog/${storefront}/songs`, {
      headers: headers(), params: { 'filter[isrc]': isrc },
    });
    const tracks = (response.data.data || []).map(songToTrack);
    await cache.set(cacheKey, tracks, 86400);
    return tracks;
  }

  // Apple Music-specific: library access requires the user's Music-User-Token.
  async getLibraryTracks(userToken, { limit = 50, offset = 0 } = {}) {
    const response = await appleMusicClient.get('/me/library/songs', {
      headers: headers(userToken), params: { limit, offset },
    });
    return (response.data.data || []).map(songToTrack);
  }

  async getLibraryPlaylists(userToken, { limit = 50, offset = 0 } = {}) {
    const response = await appleMusicClient.get('/me/library/playlists', {
      headers: headers(userToken), params: { limit, offset },
    });
    return response.data.data || [];
  }

  async createPlaylist(userToken, name, description = '') {
    const response = await appleMusicClient.post('/me/library/playlists',
      { attributes: { name, description } },
      { headers: headers(userToken) }
    );
    return response.data.data || [];
  }

  async addToPlaylist(userToken, playlistId, songIds) {
    const response = await appleMusicClient.post(
      `/me/library/playlists/${playlistId}/tracks`,
      { data: songIds.map(id => ({ id, type: 'songs' })) },
      { headers: headers(userToken) }
    );
    return response.data;
  }
}

export default AppleMusicProvider;
