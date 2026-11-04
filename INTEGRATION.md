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

## Addendum — Universal Link Resolver (curriculum module)

`GET /api/v1/music/resolve?url=<link>` (JWT-gated) turns a link from any
major music service into normalized metadata plus playable audio routes.
It is a self-contained teaching module in four parts:

- **URL parsing as a pure function** (`src/services/linkParsers.js`): no
  network, fully unit-tested. Every service encodes identity differently —
  Spotify URIs and locale prefixes, Apple Music's `?i=` track-in-album,
  SoundCloud's slug paths, Bandcamp's artist subdomains, short-link hosts
  that must be followed before they can be parsed at all.
- **Redirect handling**: short links are followed (bounded: 5 redirects,
  8s timeout) and the *final* URL is re-parsed — parse, don't guess.
- **ISRC as identity** (`src/services/linkResolver.js`): when the source
  service offers no audio, the track's ISRC finds the same recording on
  Deezer and borrows its preview. Identity first, audio second.
- **Graceful degradation as a contract**: every response carries either
  audio or an `audioNote` explaining its absence, and a `playback` block
  naming the best *official* route to the full track (direct stream →
  client SDK under the user's own subscription → official embed →
  preview floor). Cross-service links (song.link) enrich when available
  and silently degrade when not — enrichment must never be a single
  point of failure.

Student exercise: add a ninth service end-to-end — parser case, resolver
branch, playback route, tests — without touching the route handler.

## Addendum — Listen-Along Rooms (curriculum module)

`/api/v1/rooms` adds synchronous group listening on top of the resolver:
the server owns queue + transport state, clients play from their own
services. Three teaching threads:

- **State machines** (`src/services/rooms.js`): the transport is a small
  explicit machine — paused/playing × position base + start timestamp,
  with play/pause/seek/skip/back transitions and lazy auto-advance when
  a track's duration elapses. The store is a factory with an injectable
  clock, so every transition is unit-tested against fake time with no
  timers and no flakiness. Discussion: why position is stored as
  (basePosition, startedAt) rather than ticked by a server interval.
- **SSE vs WebSockets**: rooms push state with Server-Sent Events — a
  one-way, text-based stream that rides ordinary HTTP, reconnects
  natively in browsers, and needs no new dependency. The traffic here is
  server→client state broadcasts; client→server actions are plain POSTs.
  Exercise: name a feature that would genuinely require WebSockets'
  bidirectional channel, and one that would not.
- **Clock synchronization**: the server clock is the only authority.
  State carries `serverTime` alongside `positionMs`; clients estimate
  their offset and correct drift on every event rather than free-running
  — the same problem NTP and multiplayer games solve, at room scale.
  Per-member `yourSource` selection shows the payoff of normalized data:
  one shared queue, a different playback pipe per listener, chosen from
  data the resolver already produced.
