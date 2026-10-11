# Academy Integration — @AT_Music Server

Defines how the @AT_Music backend server integrates with the Detroit Automation Academy ecosystem.

## What it is

A Node.js/Express backend that aggregates music data from multiple providers (Last.fm, Apple Music, Spotify) behind a single unified API. It serves the @AT_Music iOS app and any Academy project that needs music metadata, listening history, or playlist management.

## Why it belongs in the Academy

Music-data pipelines are a core Academy technical thread: real APIs, real authentication flows, real data normalization problems. The server is a teaching artifact as much as a production service:

- **Provider architecture** demonstrates interface design — students implement `MusicProvider` to add a new source without touching routes.
- **Authentication patterns** cover JWT, API keys, OAuth client credentials, and per-request user tokens.
- **Data normalization** shows why `normalizeTrack()` exists: every API returns a different shape for the same song.
- **Caching strategy** (Redis, TTLs per data type) is a concrete performance lesson.

## Integration points

### Curriculum
- Backend API design module: students read the provider registry, then add a fourth provider (YouTube Music, Deezer, Tidal).
- Authentication module: trace a request from iOS app through JWT middleware to the Spotify client-credentials flow.
- Data engineering module: ISRC as a cross-service identity key — resolve the same track across Last.fm, Apple Music, and Spotify.

### Academy website
- The `/api/v1/music/search` endpoint can power a "now playing" or listening-stats widget on detroitautomationacademy.com without exposing API keys (server holds credentials, browser holds nothing).
- No website integration is live. Any widget requires his explicit approval before deployment.

### iOS app (@AT_Music)
- Primary consumer. See `IOS_INTEGRATION.md` for the app-side contract.
- Auth: JWT for server access, `Music-User-Token` header for Apple Music library operations.

## Ownership

- Repository: `smit4786/at-music-server`
- Deployment: Docker image builds in CI. No auto-deploy is configured (the Railway workflow was removed after 8 months of failures from a missing token). Deployment target is his call.
- Secrets (`LASTFM_API_KEY`, `APPLE_MUSIC_DEVELOPER_TOKEN`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `JWT_SECRET`) are environment variables, never committed.

## Boundaries

- The server holds third-party API credentials. It is not a public demo endpoint — access requires JWT authentication.
- Apple Music user tokens are passed per-request and never stored server-side.
- Adding a new consumer (website widget, student project, third-party app) needs his approval.
