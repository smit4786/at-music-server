# @AT_Music Backend Server

Production-ready Node.js backend for @AT_Music iOS app.

## Features

**User Authentication**
- JWT-based authentication
- User registration and login
- Token management

**Last.fm Integration**
- API proxy for secure credential handling
- Recent tracks retrieval
- User info fetching
- Top artists statistics
- Track search

**Performance**
- Redis caching (optional)
- Rate limiting
- Request throttling
- Optimized queries

**Security**
- CORS enabled
- Rate limiting
- Input validation
- Error handling

## Quick Start

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Set your Last.fm API credentials:
```bash
LASTFM_API_KEY=your_api_key_here
JWT_SECRET=your_jwt_secret_here
```

### Development

```bash
npm run dev
```

Server runs on `http://localhost:3000`

### Production

```bash
npm start
```

## API Endpoints

### Authentication

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
```

### Tracks (Requires JWT Token)

```
POST   /api/tracks/recent?page=1&limit=50
POST   /api/tracks/info
GET    /api/tracks/top-artists?period=7day&limit=10
GET    /api/tracks/search?query=artist_name
```

## Request Examples

### Register

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "lastfmUsername": "justin55mith",
    "lastfmApiKey": "your_key_here"
  }'
```

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "myuser",
    "lastfmUsername": "justin55mith",
    "lastfmApiKey": "your_key_here"
  }'
```

### Get Recent Tracks

```bash
curl -X POST http://localhost:3000/api/tracks/recent \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "justin55mith"
  }'
```

## Deployment

### Railway.app (Recommended)

1. Create account at railway.app
2. Connect GitHub repository
3. Set environment variables in dashboard
4. Deploy automatically

### Heroku

```bash
heroku create at-music-server
heroku config:set LASTFM_API_KEY=your_key
heroku config:set JWT_SECRET=your_secret
git push heroku main
```

### Docker

```bash
docker build -t at-music-server .
docker run -p 3000:3000 -e LASTFM_API_KEY=key at-music-server
```

## Architecture

```
routes/
├── auth.js          - Authentication endpoints
└── tracks.js        - Track data endpoints

controllers/
├── authController.js    - Auth logic
└── tracksController.js  - Track logic

services/
└── lastfmService.js     - Last.fm API integration

middleware/
├── auth.js          - JWT verification
└── rateLimiter.js   - Request rate limiting

config/
├── config.js        - Configuration
└── redis.js         - Redis caching
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| PORT | No | Server port (default: 3000) |
| NODE_ENV | No | development\|production |
| JWT_SECRET | Yes | JWT signing key |
| LASTFM_API_KEY | Yes | Last.fm API key |
| REDIS_URL | No | Redis connection URL |

## Performance Optimizations

- Redis caching for track data
- Rate limiting per IP
- Request deduplication
- Connection pooling
- Error recovery

## Future Enhancements

- [ ] Database integration (MongoDB/PostgreSQL)
- [ ] Multiple music service support (Spotify, Apple Music)
- [ ] User statistics dashboard
- [ ] Social features
- [ ] Advanced analytics
- [ ] Webhook support

## License

MIT

## Apple Music API

New in this release: Apple Music catalog and library access via the MusicKit API.

### Endpoints

Catalog (no user token required):

```
GET    /api/apple-music/search?term=query&types=songs,albums,artists&limit=10
GET    /api/apple-music/isrc/:isrc
```

Library (requires `Music-User-Token` header — the user's MusicKit token, never stored server-side):

```
GET    /api/apple-music/library/tracks
GET    /api/apple-music/library/playlists
POST   /api/apple-music/library/playlists
POST   /api/apple-music/library/playlists/:playlistId/tracks
```

### Configuration

Set `APPLE_MUSIC_DEVELOPER_TOKEN` in `.env` (MusicKit developer token from the Apple Developer portal).

## v1 Provider API (extensible)

All music data sources implement the `MusicProvider` interface (`src/services/providers/MusicProvider.js`). Adding a new provider (Spotify, YouTube Music) means implementing four methods and registering in `src/services/providers/index.js` — routes never change.

### Endpoints

```
GET    /api/v1/music/providers
GET    /api/v1/music/search?provider=apple-music&term=...&limit=10
GET    /api/v1/music/recent?provider=lastfm&username=...&limit=50
GET    /api/v1/music/isrc/:isrc
GET    /api/v1/music/library/tracks          (Music-User-Token header)
GET    /api/v1/music/library/playlists       (Music-User-Token header)
POST   /api/v1/music/library/playlists       (Music-User-Token header)
POST   /api/v1/music/library/playlists/:playlistId/tracks
```

### Response format

All v1 endpoints return a standardized envelope:

```json
{ "success": true, "data": [...] }
{ "success": false, "error": { "message": "...", "code": "PROVIDER_ERROR" } }
```

### Security

- Helmet sets secure HTTP headers on all responses.
- Stack traces are never exposed in production error responses.
- User tokens (Music-User-Token) are passed per-request via header, never stored server-side.

### Spotify provider

Registered as `spotify` in the provider registry. Uses the client credentials flow (no user OAuth required for search and ISRC lookup).

```
GET /api/v1/music/search?provider=spotify&term=...&limit=10
GET /api/v1/music/isrc/:isrc&provider=spotify
```

Configuration: set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` (from developer.spotify.com/dashboard).

Note: recent-tracks and top-artists require user OAuth scopes (`user-read-recently-played`, `user-top-read`) and return empty arrays under client credentials.
