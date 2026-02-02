import redis from 'redis';
import config from './config.js';

let client;

export const initRedis = async () => {
  // Skip if no Redis URL configured
  if (!config.redisUrl || config.redisUrl.trim() === '') {
    console.log('⚠ Redis disabled, using in-memory mode');
    return null;
  }
  
  try {
    client = redis.createClient({
      url: config.redisUrl,
      password: config.redisPassword,
      socket: { 
        reconnectStrategy: (retries) => Math.min(retries * 50, 500),
        connectTimeout: 5000
      }
    });
    
    client.on('error', (err) => console.error('Redis error:', err));
    client.on('connect', () => console.log('✓ Redis connected'));
    
    try {
      // Use Promise.race with timeout
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
        )
      ]);
      console.log('✓ Redis connected');
    } catch (err) {
      console.warn('⚠ Redis unavailable, continuing without cache:', err.message);
      client = null;
    }
    return client;
  } catch (error) {
    console.warn('⚠ Redis initialization skipped, continuing without cache');
    client = null;
    return null;
  }
};

export const getRedisClient = () => client;

export const cache = {
  async get(key) {
    if (!client) return null;
    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  },
  
  async set(key, value, ttl = config.cacheDefaultTTL) {
    if (!client) return;
    try {
      await client.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  },
  
  async del(key) {
    if (!client) return;
    try {
      await client.del(key);
    } catch (error) {
      console.error('Cache del error:', error);
    }
  },
  
  async clear(pattern) {
    if (!client) return;
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(keys);
      }
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  },
};

export default { initRedis, getRedisClient, cache };
