import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // JWT
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  jwtExpiration: '7d',
  
  // Redis
  redisUrl: process.env.REDIS_URL && process.env.REDIS_URL.trim() ? process.env.REDIS_URL : '',
  redisPassword: process.env.REDIS_PASSWORD,
  
  // Last.fm
  lastfmApiKey: process.env.LASTFM_API_KEY || '',
  lastfmApiSecret: process.env.LASTFM_API_SECRET || '',
  lastfmApiUrl: 'https://ws.audioscrobbler.com/2.0',
  
  // Database (placeholder for future)
  dbUrl: process.env.DATABASE_URL || 'mongodb://localhost:27017/at-music',
  
  // Cache
  cacheDefaultTTL: 300, // 5 minutes
  cacheTracksPerPage: 50,
};

export default config;
