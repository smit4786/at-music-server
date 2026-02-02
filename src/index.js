import express from 'express';
import cors from 'cors';
import config from './config/config.js';
import { initRedis } from './config/redis.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import authRoutes from './routes/auth.js';
import tracksRoutes from './routes/tracks.js';

const app = express();

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
    version: '1.0.0',
    name: '@AT_Music Server',
    description: 'Backend service for @AT_Music iOS app',
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tracks', tracksRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// Initialize and start server
const startServer = async () => {
  try {
    // Initialize Redis (optional)
    await initRedis();
    
    app.listen(config.port, () => {
      console.log(`\n✓ @AT_Music Server running on port ${config.port}`);
      console.log(`✓ Environment: ${config.nodeEnv}`);
      console.log(`✓ Health check: http://localhost:${config.port}/health\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
