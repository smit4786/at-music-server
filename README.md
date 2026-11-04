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

### Universal Link Resolver (v1, Requires JWT Token)

Paste a link from any supported music service; get back normalized metadata,
the best audio this server can deliver directly, and the best route to the
**full** track in a client app.

```
GET /api/v1/music/resolve?url=<link>
```

Supported links: Spotify (incl. `spotify:` URIs and `/intl-xx/` paths),
Apple Music, SoundCloud, YouTube / YouTube Music, Deezer, Tidal, Bandcamp,
Audius, and short links from those services (`spotify.link`,
`on.soundcloud.com`, `deezer.page.link`, `link.deezer.com`) — redirects are
followed and the final URL is re-parsed.

Response `data` uses the standard track fields (`name`, `artist`, `album`,
`isrc`, `url`, `image`, `durationMs`) plus:

- `audio` — server-deliverable audio: `{ kind: 'full' | 'preview', url, durationSec, source, via }`
  or `null`. Previews come from the source service when it offers one; when it
  doesn't and an ISRC is known, a 30-second Deezer preview is cross-matched by
  ISRC (`via: 'isrc-cross-match'`).
- `audioNote` — when `audio` is null (or partial), exactly why.
- `playback` — the best route to the **full track**, in priority order:
  `stream` (direct full-audio URL) → `sdk` (full playback in the client under
  the user's own subscription via the service's official SDK) → `embed`
  (official embed player) → `preview` (the floor) → `none`.
  Shape: `{ method, streamUrl?, embedUrl?, sdk?: { service, trackId, uri?, storefront? }, requiresSubscription }`.
- `crossLinks` — the same item on other services, via the song.link API.
  Best-effort: the keyless public endpoint currently answers
  `401 PUBLIC_API_ACCESS_DEPRECATED`, so this is usually `{}` in practice.
- `embedUrl` — the service's official embed player URL, when one exists.

Errors: `400 VALIDATION_ERROR` (missing `url`), `400 UNSUPPORTED_LINK`
(not a recognized music link), `502 UPSTREAM_ERROR` (the source service
failed and nothing could be resolved).

| Service | Server audio (`audio`) | Best full-track playback (`playback`) | Subscription required |
|---|---|---|---|
| Spotify | 30s preview (API, needs server credentials; none via oEmbed) | `sdk` — Spotify App Remote / Web Playback (`spotify:track:{id}`) | Yes (Premium) |
| Apple Music | 30s preview (catalog API, needs developer token; otherwise parse-only) | `sdk` — MusicKit (`trackId` + `storefront`) | Yes (Apple Music) |
| Deezer | 30s preview (public API, no auth) | `embed` — Deezer widget player | No |
| SoundCloud | Full stream only with `SOUNDCLOUD_CLIENT_ID` configured; otherwise none | `embed` — SoundCloud widget (or `stream` when a stream URL resolves) | No |
| YouTube / YT Music | None — licensed for embed playback only | `embed` — official YouTube player (`videoId`) | No |
| Audius | **Full stream** (public discovery API) | `stream` — direct stream URL | No |
| Tidal | None unless the page exposes `og:audio` | `embed` — Tidal embed player | No |
| Bandcamp | Only when the page exposes `og:audio` | `embed` — Bandcamp embedded player (from `og:video`) | No |

All playback routes are official surfaces of the respective services. The
resolver never extracts streams from services that don't offer them and does
not circumvent DRM or licensing controls.

```bash
curl "http://localhost:3000/api/v1/music/resolve?url=https%3A%2F%2Fwww.deezer.com%2Ftrack%2F1109731" \
  -H "Authorization: Bearer <token>"
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
