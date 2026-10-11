import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/config.js';
import { initRedis } from './config/redis.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import authRoutes from './routes/auth.js';
import tracksRoutes from './routes/tracks.js';
import appleMusicRoutes from './routes/appleMusic.js';
import musicRoutes from './routes/music.js';

const app = express();

// Security headers
app.use(helmet());

// Middleware
app.use(cors());
app.use(express.json());
app.use(apiLimiter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// API version
app.get('/api/version', (req, res) => {
  res.json({
    version: '1.1.0',
    name: '@AT_Music Server',
    description: 'Backend service for @AT_Music iOS app',
  });
});

// Routes (legacy)
app.use('/api/auth', authRoutes);
app.use('/api/tracks', tracksRoutes);
app.use('/api/apple-music', appleMusicRoutes);

// Routes (v1 — provider-abstracted)
app.use('/api/v1/music', musicRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: { message: 'Route not found', code: 'NOT_FOUND' } });
});

// Centralized error handler — never leaks stack traces in production
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: {
      message: config.nodeEnv === 'development' ? err.message : 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
    },
  });
});
