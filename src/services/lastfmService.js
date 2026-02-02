import axios from 'axios';
import config from '../config/config.js';
import { cache } from '../config/redis.js';

const lastfmClient = axios.create({
  baseURL: config.lastfmApiUrl,
  timeout: 10000,
});

export class LastFMService {
  static async getRecentTracks(username, page = 1, limit = 50) {
    try {
      const cacheKey = `lastfm:tracks:${username}:${page}`;
      
      // Check cache first
      const cached = await cache.get(cacheKey);
      if (cached) return cached;
      
      const response = await lastfmClient.get('/', {
        params: {
          method: 'user.getrecenttracks',
          user: username,
          api_key: config.lastfmApiKey,
          format: 'json',
          limit,
          page,
        },
      });
      
      if (response.data.error) {
        throw new Error(`Last.fm error: ${response.data.message}`);
      }
      
      const tracks = response.data.recenttracks?.track || [];
      
      // Cache for 5 minutes
      await cache.set(cacheKey, tracks, 300);
      
      return tracks;
    } catch (error) {
      console.error('LastFM getRecentTracks error:', error.message);
      throw error;
    }
  }
  
  static async getUserInfo(username) {
    try {
      const cacheKey = `lastfm:user:${username}`;
      
      // Check cache
      const cached = await cache.get(cacheKey);
      if (cached) return cached;
      
      const response = await lastfmClient.get('/', {
        params: {
          method: 'user.getinfo',
          user: username,
          api_key: config.lastfmApiKey,
          format: 'json',
        },
      });
      
      if (response.data.error) {
        throw new Error(`Last.fm error: ${response.data.message}`);
      }
      
      const userInfo = response.data.user;
      
      // Cache for 24 hours
      await cache.set(cacheKey, userInfo, 86400);
      
      return userInfo;
    } catch (error) {
      console.error('LastFM getUserInfo error:', error.message);
      throw error;
    }
  }
  
  static async getTopArtists(username, period = '7day', limit = 10) {
    try {
      const cacheKey = `lastfm:artists:${username}:${period}`;
      
      const cached = await cache.get(cacheKey);
      if (cached) return cached;
      
      const response = await lastfmClient.get('/', {
        params: {
          method: 'user.gettopartists',
          user: username,
          period,
          api_key: config.lastfmApiKey,
          format: 'json',
          limit,
        },
      });
      
      if (response.data.error) {
        throw new Error(`Last.fm error: ${response.data.message}`);
      }
      
      const artists = response.data.topartists?.artist || [];
      
      // Cache for 1 hour
      await cache.set(cacheKey, artists, 3600);
      
      return artists;
    } catch (error) {
      console.error('LastFM getTopArtists error:', error.message);
      throw error;
    }
  }
  
  static async searchTracks(query, limit = 20) {
    try {
      const cacheKey = `lastfm:search:${query}`;
      
      const cached = await cache.get(cacheKey);
      if (cached) return cached;
      
      const response = await lastfmClient.get('/', {
        params: {
          method: 'track.search',
          track: query,
          api_key: config.lastfmApiKey,
          format: 'json',
          limit,
        },
      });
      
      if (response.data.error) {
        throw new Error(`Last.fm error: ${response.data.message}`);
      }
      
      const tracks = response.data.results?.trackmatches?.track || [];
      
      // Cache for 1 hour
      await cache.set(cacheKey, tracks, 3600);
      
      return tracks;
    } catch (error) {
      console.error('LastFM searchTracks error:', error.message);
      throw error;
    }
  }
  
  static async validateCredentials(username, apiKey) {
    try {
      const response = await axios.get(config.lastfmApiUrl, {
        params: {
          method: 'user.getinfo',
          user: username,
          api_key: apiKey,
          format: 'json',
        },
        timeout: 5000,
      });
      
      return !response.data.error;
    } catch (error) {
      console.error('LastFM validation error:', error.message);
      return false;
    }
  }
}

export default LastFMService;
