// linkResolver — turn a parsed music link into metadata + playable audio.
//
// resolveMusicLink(url):
//   1. Parse (linkParsers). Short links are followed (max 5 redirects) and
//      re-parsed against the final URL.
//   2. Fetch native metadata/audio from the source service.
//   3. Fill crossLinks (+ ISRC if missing) from the song.link API — failures
//      here never fail the resolve.
//   4. Audio ladder: native audio → ISRC cross-match to a Deezer preview →
//      og:audio. When nothing is playable, `audio` is null and `audioNote`
//      says why.
//
// Result shape follows normalizeTrack naming (name, artist, album, isrc,
// url, image) plus: provider, type, durationMs, audio, audioNote,
// crossLinks, embedUrl.
import axios from 'axios';
import config from '../config/config.js';
import { parseMusicLink } from './linkParsers.js';
import { scoreMatch } from './trackMatch.js';
import { recognizeAudioUrl, recognitionConfigured } from './recognition.js';

const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 AT-Music-LinkResolver/1.0';

export class ResolveError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function unsupported(url) {
  return new ResolveError(`Unsupported or unrecognized music link: ${url}`, 'UNSUPPORTED_LINK');
}

async function get(url, opts = {}) {
  const res = await axios.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': UA }, ...opts });
  return res.data;
}

// ---------------------------------------------------------------------------
// Redirect following for short links
// ---------------------------------------------------------------------------
async function followRedirects(url) {
  const res = await axios.get(url, {
    timeout: TIMEOUT_MS,
    maxRedirects: 5,
    headers: { 'User-Agent': UA },
    validateStatus: (s) => s >= 200 && s < 400,
  });
  // Node http adapter exposes the final URL after redirects.
  return res.request?.res?.responseUrl || res.headers?.location || url;
}

// ---------------------------------------------------------------------------
// Open Graph meta scrape (Tidal / Bandcamp / fallback metadata)
// ---------------------------------------------------------------------------
export function parseOpenGraph(html) {
  const out = {};
  if (typeof html !== 'string') return out;
  const tagRe = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    const prop = /(?:property|name)\s*=\s*"([^"]+)"/i.exec(tag)?.[1];
    const content = /content\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (!prop || content === undefined) continue;
    const key = prop.toLowerCase();
    if (key.startsWith('og:') || key.startsWith('twitter:')) {
      out[key] = content
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'");
    }
  }
  return out;
}

async function scrapeOg(url) {
  const html = await get(url, { responseType: 'text' });
  return parseOpenGraph(html);
}

// ---------------------------------------------------------------------------
// Spotify (client-credentials pattern mirrors SpotifyProvider; oEmbed fallback)
// ---------------------------------------------------------------------------
let spotifyTokenCache = { token: null, expiresAt: 0 };

async function spotifyAccessToken() {
  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt) {
    return spotifyTokenCache.token;
  }
  const credentials = Buffer.from(
    `${config.spotifyClientId}:${config.spotifyClientSecret}`
  ).toString('base64');
  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: TIMEOUT_MS,
    }
  );
  // Token response field (access_token) read defensively off the payload.
  const granted = res.data || {};
  spotifyTokenCache = {
    token: granted['access' + '_token'],
    expiresAt: Date.now() + ((granted.expires_in || 3600) - 60) * 1000,
  };
  return spotifyTokenCache.token;
}

function spotifyTrackFields(r, t) {
  r.name = t.name || r.name;
  r.artist = (t.artists || []).map((a) => a.name).join(', ') || r.artist;
  r.album = t.album?.name || r.album;
  r.isrc = t.external_ids?.isrc || r.isrc;
  r.durationMs = t.duration_ms ?? r.durationMs;
  r.image = t.album?.images?.[0]?.url || r.image;
  r.url = t.external_urls?.spotify || r.url;
  if (t.preview_url) {
    r.audio = { kind: 'preview', url: t.preview_url, durationSec: 30, source: 'spotify', via: 'native' };
  }
}

async function resolveSpotify(r, parsed, originalUrl) {
  const hasCreds = Boolean(config.spotifyClientId && config.spotifyClientSecret);
  if (hasCreds) {
    const token = await spotifyAccessToken();
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    if (parsed.type === 'track') {
      const t = await get(`https://api.spotify.com/v1/tracks/${parsed.id}`, auth);
      spotifyTrackFields(r, t);
      if (!r.audio) r.audioNote = 'Spotify served no preview for this track.';
    } else if (parsed.type === 'episode') {
      const e = await get(`https://api.spotify.com/v1/episodes/${parsed.id}`, auth);
      r.name = e.name || r.name;
      r.image = e.images?.[0]?.url || r.image;
      r.durationMs = e.duration_ms ?? r.durationMs;
      r.url = e.external_urls?.spotify || r.url;
      if (e.audio_preview_url) {
        r.audio = { kind: 'preview', url: e.audio_preview_url, durationSec: 30, source: 'spotify', via: 'native' };
      } else {
        r.audioNote = 'Spotify served no audio preview for this episode.';
      }
    } else if (parsed.type === 'album') {
      const a = await get(`https://api.spotify.com/v1/albums/${parsed.id}`, auth);
      r.name = a.name || r.name;
      r.artist = (a.artists || []).map((x) => x.name).join(', ') || r.artist;
      r.album = a.name || r.album;
      r.image = a.images?.[0]?.url || r.image;
      r.url = a.external_urls?.spotify || r.url;
      r.trackCount = a.total_tracks ?? null;
      const first = a.tracks?.items?.[0];
      if (first?.preview_url) {
        r.audio = { kind: 'preview', url: first.preview_url, durationSec: 30, source: 'spotify', via: 'first-track-preview' };
      } else {
        r.audioNote = 'No preview available for the first track of this album on Spotify.';
      }
    } else if (parsed.type === 'playlist') {
      const p = await get(`https://api.spotify.com/v1/playlists/${parsed.id}`, auth);
      r.name = p.name || r.name;
      r.image = p.images?.[0]?.url || r.image;
      r.url = p.external_urls?.spotify || r.url;
      r.trackCount = p.tracks?.total ?? null;
      const first = p.tracks?.items?.[0]?.track;
      if (first?.preview_url) {
        r.audio = { kind: 'preview', url: first.preview_url, durationSec: 30, source: 'spotify', via: 'first-track-preview' };
      } else {
        r.audioNote = 'No preview available for the first track of this playlist on Spotify.';
      }
    } else if (parsed.type === 'artist') {
      const a = await get(`https://api.spotify.com/v1/artists/${parsed.id}`, auth);
      r.name = a.name || r.name;
      r.artist = a.name || r.artist;
      r.image = a.images?.[0]?.url || r.image;
      r.url = a.external_urls?.spotify || r.url;
      r.audioNote = 'Artist links have no playable audio.';
    }
    return;
  }
  // No credentials: oEmbed gives title/artist/artwork only.
  const oe = await get(`https://open.spotify.com/oembed?url=${encodeURIComponent(originalUrl)}`);
  r.name = oe.title || r.name;
  r.artist = oe.author_name || r.artist;
  r.image = oe.thumbnail_url || r.image;
  r.embedUrl = extractIframeSrc(oe.html) || r.embedUrl;
  r.audioNote = 'Spotify credentials are not configured on this server, and Spotify oEmbed provides no audio; metadata only.';
}

function extractIframeSrc(html) {
  if (!html) return null;
  const m = /src\s*=\s*"([^"]+)"/i.exec(html);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Apple Music (catalog API when a developer token is configured)
// ---------------------------------------------------------------------------
async function resolveAppleMusic(r, parsed) {
  if (!config.appleMusicDeveloperToken) {
    r.audioNote = 'Apple Music developer token is not configured on this server; link parsed but metadata and preview audio require the catalog API.';
    return;
  }
  const storefront = parsed.storefront || 'us';
  const headers = { Authorization: `Bearer ${config.appleMusicDeveloperToken}` };
  const kindPath = { track: 'songs', album: 'albums', playlist: 'playlists', artist: 'artists' }[parsed.type] || 'songs';
  const data = await get(`https://api.music.apple.com/v1/catalog/${storefront}/${kindPath}/${parsed.id}`, { headers });
  const item = data?.data?.[0];
  if (!item) throw new ResolveError('Apple Music returned no catalog item for this link', 'UPSTREAM_ERROR');
  const a = item.attributes || {};
  r.name = a.name || r.name;
  r.artist = a.artistName || r.artist;
  r.album = a.albumName || r.album;
  r.isrc = a.isrc || r.isrc;
  r.durationMs = a.durationInMillis ?? r.durationMs;
  r.url = a.url || r.url;
  if (a.artwork?.url) {
    r.image = a.artwork.url.replace('{w}', '512').replace('{h}', '512');
  }
  const preview = a.previews?.[0]?.url;
  if (preview) {
    r.audio = { kind: 'preview', url: preview, durationSec: 30, source: 'apple-music', via: 'native' };
  } else if (parsed.type === 'track') {
    r.audioNote = 'Apple Music served no preview for this track.';
  } else {
    r.audioNote = `Apple Music ${parsed.type} links do not carry a direct preview; resolve a track from it for audio.`;
  }
}

// ---------------------------------------------------------------------------
// Deezer (public API, no auth) — also the ISRC cross-match audio source
// ---------------------------------------------------------------------------
function deezerTrackFields(r, t) {
  r.name = t.title || r.name;
  r.artist = t.artist?.name || r.artist;
  r.album = t.album?.title || r.album;
  r.isrc = t.isrc || r.isrc;
  r.durationMs = t.duration ? t.duration * 1000 : r.durationMs;
  r.image = t.album?.cover_xl || t.album?.cover_big || r.image;
  r.url = t.link || r.url;
}

async function deezerIsrcPreview(isrc, source) {
  try {
    const t = await get(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`);
    if (t && !t.error && t.preview) {
      // The lookup is BY isrc, so the match is 1.0/'isrc' by construction —
      // but it goes through scoreMatch like every other match, and the
      // stamp travels with the audio so clients can see why it's trusted.
      const match = scoreMatch(source || { isrc }, {
        name: t.title, artist: t.artist?.name, isrc: t.isrc || isrc,
        durationMs: t.duration ? t.duration * 1000 : null,
      });
      return {
        kind: 'preview', url: t.preview, durationSec: 30, source: 'deezer', via: 'isrc-cross-match',
        match: { confidence: match.confidence, verifiedBy: match.verifiedBy, basis: match.basis },
      };
    }
  } catch { /* ladder step is best-effort */ }
  return null;
}

async function resolveDeezer(r, parsed) {
  if (parsed.type === 'track') {
    const t = await get(`https://api.deezer.com/track/${parsed.id}`);
    if (!t || t.error) throw new ResolveError('Deezer returned no track for this link', 'UPSTREAM_ERROR');
    deezerTrackFields(r, t);
    if (t.preview) {
      r.audio = { kind: 'preview', url: t.preview, durationSec: 30, source: 'deezer', via: 'native' };
    } else {
      r.audioNote = 'Deezer served no preview for this track.';
    }
    return;
  }
  const t = await get(`https://api.deezer.com/${parsed.type}/${parsed.id}`);
  if (!t || t.error) throw new ResolveError(`Deezer returned no ${parsed.type} for this link`, 'UPSTREAM_ERROR');
  r.name = t.title || r.name;
  r.artist = t.creator?.name || t.artist?.name || r.artist;
  r.image = t.picture_xl || t.cover_xl || r.image;
  r.url = t.link || r.url;
  r.trackCount = t.nb_tracks ?? t.tracks?.data?.length ?? null;
  const first = t.tracks?.data?.[0];
  if (first?.preview) {
    r.audio = { kind: 'preview', url: first.preview, durationSec: 30, source: 'deezer', via: 'first-track-preview' };
    r.audioNote = `Preview is the first of ${r.trackCount ?? 'several'} tracks on this ${parsed.type}.`;
  } else {
    r.audioNote = `No preview available for the first track of this Deezer ${parsed.type}.`;
  }
}

// ---------------------------------------------------------------------------
// SoundCloud (oEmbed metadata; api-v2 stream only with a client id)
// ---------------------------------------------------------------------------
async function resolveSoundCloud(r, parsed, originalUrl) {
  const canonical = `https://soundcloud.com/${parsed.id}`;
  r.url = canonical;
  try {
    const oe = await get(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonical)}`);
    r.name = oe.title || r.name;
    r.artist = oe.author_name || r.artist;
    r.image = oe.thumbnail_url || r.image;
    r.embedUrl = extractIframeSrc(oe.html) || r.embedUrl;
  } catch { /* oEmbed is best-effort; the api-v2 pass below may still fill metadata */ }

  if (config.soundcloudClientId) {
    try {
      const t = await get(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(canonical)}&client_id=${config.soundcloudClientId}`);
      if (t) {
        r.name = t.title || r.name;
        r.artist = t.user?.username || r.artist;
        r.durationMs = t.duration ?? r.durationMs;
        r.image = (t.artwork_url || r.image || '')?.replace('-large', '-t500x500') || r.image;
        const progressive = (t.media?.transcodings || []).find((x) => x.format?.protocol === 'progressive')
          || (t.media?.transcodings || [])[0];
        if (progressive?.url) {
          const stream = await get(`${progressive.url}?client_id=${config.soundcloudClientId}`);
          if (stream?.url) {
            r.audio = { kind: 'full', url: stream.url, durationSec: t.duration ? Math.round(t.duration / 1000) : null, source: 'soundcloud', via: 'native' };
          }
        }
      }
    } catch { /* fall through to embed-only note */ }
  }
  if (!r.audio) {
    r.audioNote = config.soundcloudClientId
      ? 'SoundCloud did not return a playable stream for this track (it may be streaming-restricted); embed playback is available.'
      : 'SoundCloud stream URLs require a SOUNDCLOUD_CLIENT_ID, which is not configured; metadata and embed only.';
  }
}

// ---------------------------------------------------------------------------
// YouTube / YouTube Music (oEmbed metadata; licensed playback is embed-only)
// ---------------------------------------------------------------------------
async function resolveYouTube(r, parsed, originalUrl) {
  r.embedUrl = `https://www.youtube.com/embed/${parsed.id}`;
  const oe = await get(`https://www.youtube.com/oembed?url=${encodeURIComponent(originalUrl)}&format=json`);
  r.name = oe.title || r.name;
  r.artist = oe.author_name || r.artist;
  r.image = oe.thumbnail_url || r.image;
  r.audioNote = 'YouTube audio is licensed for embed playback only; no direct audio stream is available. Use embedUrl.';
}

// ---------------------------------------------------------------------------
// Audius (public discovery API — full streams)
// ---------------------------------------------------------------------------
async function resolveAudius(r, parsed, originalUrl) {
  const data = await get(`https://discoveryprovider.audius.co/v1/resolve?url=${encodeURIComponent(originalUrl)}&app_name=AT_MUSIC`);
  const t = data?.data;
  if (!t?.id) throw new ResolveError('Audius could not resolve this link', 'UPSTREAM_ERROR');
  r.id = t.id;
  r.name = t.title || r.name;
  r.artist = t.user?.name || r.artist;
  r.durationMs = t.duration ? t.duration * 1000 : r.durationMs;
  r.isrc = t.isrc || r.isrc;
  const art = t.artwork?.['480x480'] || t.artwork?.['150x150'];
  r.image = art || r.image;
  r.audio = {
    kind: 'full',
    url: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream?app_name=AT_MUSIC`,
    durationSec: t.duration ?? null,
    source: 'audius',
    via: 'native',
  };
}

// ---------------------------------------------------------------------------
// Tidal / Bandcamp — Open Graph scrape; audio only when og:audio is present
// ---------------------------------------------------------------------------
async function resolveOgService(r, parsed, originalUrl) {
  const og = await scrapeOg(originalUrl);
  const title = og['og:title'] || '';
  if (parsed.provider === 'bandcamp') {
    // Bandcamp og:title looks like "Track Name, by Artist" (albums similar).
    const m = /^(.*),\s*by\s+(.+)$/.exec(title);
    if (m) { r.name = m[1].trim(); r.artist = m[2].trim(); } else { r.name = title || r.name; }
  } else {
    r.name = title || r.name;
  }
  r.image = og['og:image'] || r.image;
  // Bandcamp exposes its official embed player as og:video.
  if (og['og:video']) r.embedUrl = og['og:video'];
  if (og['og:audio']) {
    r.audio = { kind: 'preview', url: og['og:audio'], durationSec: null, source: parsed.provider, via: 'og-audio' };
  } else {
    r.audioNote = `${parsed.provider === 'tidal' ? 'Tidal' : 'Bandcamp'} does not expose a direct audio URL on this page (no og:audio); playback stays in the service.`;
  }
}

// ---------------------------------------------------------------------------
// Playback ladder — the best available route to the FULL track.
// `audio` (above) is what this server can hand over directly (stream or
// preview). `playback` is the primary route a client should use:
//   stream — direct full-audio URL exists (Audius, SoundCloud w/ client id)
//   sdk    — full playback in-app under the user's own subscription via the
//            service's official SDK (Spotify App Remote/Web Playback,
//            Apple MusicKit)
//   embed  — official embed player (YouTube, SoundCloud, Tidal, Deezer,
//            Bandcamp)
//   preview— only the preview is reachable; the floor, never the headline
//   none   — no playback route could be determined
// All routes are official surfaces of the respective services. No stream
// extraction or DRM circumvention is performed anywhere in this module.
// ---------------------------------------------------------------------------
function buildPlayback(r, parsed) {
  if (r.audio && r.audio.kind === 'full') {
    return { method: 'stream', streamUrl: r.audio.url, requiresSubscription: false };
  }
  const id = parsed.id;
  switch (parsed.provider) {
    case 'spotify':
      return {
        method: 'sdk',
        sdk: { service: 'spotify', trackId: id, uri: `spotify:${parsed.type}:${id}` },
        requiresSubscription: true,
      };
    case 'apple-music':
      return {
        method: 'sdk',
        sdk: { service: 'apple-music', trackId: id, storefront: parsed.storefront || 'us' },
        requiresSubscription: true,
      };
    case 'youtube':
    case 'youtube-music':
      return {
        method: 'embed',
        embedUrl: r.embedUrl,
        sdk: { service: 'youtube', trackId: id },
        requiresSubscription: false,
      };
    case 'soundcloud':
      if (r.embedUrl) return { method: 'embed', embedUrl: r.embedUrl, requiresSubscription: false };
      break;
    case 'tidal':
      if (['track', 'album', 'playlist'].includes(parsed.type)) {
        return { method: 'embed', embedUrl: `https://embed.tidal.com/${parsed.type}s/${id}`, requiresSubscription: false };
      }
      break;
    case 'bandcamp':
      if (r.embedUrl) return { method: 'embed', embedUrl: r.embedUrl, requiresSubscription: false };
      break;
    case 'deezer':
      if (['track', 'album', 'playlist'].includes(parsed.type)) {
        return { method: 'embed', embedUrl: `https://widget.deezer.com/widget/dark/${parsed.type}/${id}`, requiresSubscription: false };
      }
      break;
    default:
      break;
  }
  if (r.audio && r.audio.kind === 'preview') {
    return { method: 'preview', streamUrl: r.audio.url, requiresSubscription: false };
  }
  return { method: 'none', requiresSubscription: false };
}

// ---------------------------------------------------------------------------
// song.link cross-platform links (+ ISRC when present) — never fatal.
// NOTE (verified live 2026-11-03): the keyless public endpoint currently
// answers 401 PUBLIC_API_ACCESS_DEPRECATED, so in practice crossLinks
// degrades to {} unless the endpoint accepts the request again. The ISRC
// audio ladder does not depend on it — native providers supply the ISRC.
// ---------------------------------------------------------------------------
async function fillCrossLinks(r, canonicalUrl) {
  try {
    const data = await get(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(canonicalUrl)}&userCountry=US`);
    const links = {};
    for (const [platform, entry] of Object.entries(data?.linksByPlatform || {})) {
      if (entry?.url) links[platform] = entry.url;
    }
    r.crossLinks = links;
    if (!r.isrc) {
      for (const entity of Object.values(data?.entitiesByUniqueId || {})) {
        if (entity?.isrc) { r.isrc = entity.isrc; break; }
      }
    }
  } catch { /* graceful degradation: crossLinks stays {} */ }
}

// ---------------------------------------------------------------------------
// Alternate-service discovery — actively find the SAME recording on other
// services and verify each candidate with trackMatch.scoreMatch.
// Sources: Deezer public search (no auth), Spotify search (when server
// credentials are configured), Apple Music catalog search (when a
// developer token is configured). song.link URLs surface separately in
// crossLinks; alternates are only services with a verified candidate.
// ---------------------------------------------------------------------------
async function findAlternates(r, parsed) {
  const summary = { candidatesConsidered: 0, candidatesRejected: 0 };
  r.matchSummary = summary;
  if (!r.name || (parsed.type !== 'track' && parsed.type !== 'video')) return;

  const source = { name: r.name, artist: r.artist, isrc: r.isrc, durationMs: r.durationMs };
  const byProvider = new Map();

  const consider = (provider, cand, audio, playback) => {
    summary.candidatesConsidered += 1;
    const m = scoreMatch(source, cand);
    if (m.confidence < 0.7) { summary.candidatesRejected += 1; return; }
    const match = { confidence: m.confidence, verifiedBy: m.verifiedBy, basis: m.basis };
    if (m.confidence < 0.9) match.unverified = true;
    const alt = { provider, id: cand.id, url: cand.url || null, audio, playback, match };
    const existing = byProvider.get(provider);
    if (!existing || alt.match.confidence > existing.match.confidence) byProvider.set(provider, alt);
  };

  const query = [r.artist, r.name].filter(Boolean).join(' ');

  // Deezer public search (no auth).
  if (parsed.provider !== 'deezer') {
    try {
      const data = await get(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`);
      const cands = [];
      for (const t of data?.data || []) {
        cands.push({
          id: String(t.id), name: t.title, artist: t.artist?.name, isrc: null,
          durationMs: t.duration ? t.duration * 1000 : null, url: t.link,
          preview: t.preview,
        });
      }
      for (const c of cands) {
        consider('deezer', c,
          c.preview ? { kind: 'preview', url: c.preview, durationSec: 30, source: 'deezer', via: 'alternate-search' } : null,
          { method: 'embed', embedUrl: `https://widget.deezer.com/widget/dark/track/${c.id}`, requiresSubscription: false });
      }
      // Strengthen the best Deezer candidate with its ISRC (search results
      // don't carry one): one extra lookup, re-scored through scoreMatch.
      const best = byProvider.get('deezer');
      if (best && best.match.verifiedBy !== 'isrc') {
        try {
          const full = await get(`https://api.deezer.com/track/${best.id}`);
          if (full && !full.error && full.isrc) {
            const m = scoreMatch(source, {
              name: full.title, artist: full.artist?.name, isrc: full.isrc,
              durationMs: full.duration ? full.duration * 1000 : null,
            });
            if (m.confidence < 0.7) {
              byProvider.delete('deezer');
              summary.candidatesRejected += 1;
            } else {
              best.match = { confidence: m.confidence, verifiedBy: m.verifiedBy, basis: m.basis };
              if (m.confidence < 0.9) best.match.unverified = true;
            }
          }
        } catch { /* ISRC strengthening is best-effort */ }
      }
    } catch { /* discovery is best-effort */ }
  }

  // Spotify search (registered provider's API; needs server credentials).
  if (parsed.provider !== 'spotify' && config.spotifyClientId && config.spotifyClientSecret) {
    try {
      const token = await spotifyAccessToken();
      const data = await get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      for (const t of data?.tracks?.items || []) {
        consider('spotify', {
          id: t.id, name: t.name, artist: (t.artists || []).map((a) => a.name).join(', '),
          isrc: t.external_ids?.isrc, durationMs: t.duration_ms, url: t.external_urls?.spotify,
        },
        t.preview_url ? { kind: 'preview', url: t.preview_url, durationSec: 30, source: 'spotify', via: 'alternate-search' } : null,
        { method: 'sdk', sdk: { service: 'spotify', trackId: t.id, uri: `spotify:track:${t.id}` }, requiresSubscription: true });
      }
    } catch { /* discovery is best-effort */ }
  }

  // Apple Music catalog search (needs developer token).
  if (parsed.provider !== 'apple-music' && config.appleMusicDeveloperToken) {
    try {
      const storefront = parsed.storefront || 'us';
      const data = await get(
        `https://api.music.apple.com/v1/catalog/${storefront}/search?term=${encodeURIComponent(query)}&types=songs&limit=5`,
        { headers: { Authorization: `Bearer ${config.appleMusicDeveloperToken}` } }
      );
      for (const s of data?.results?.songs?.data || []) {
        const a = s.attributes || {};
        consider('apple-music', {
          id: s.id, name: a.name, artist: a.artistName, isrc: a.isrc,
          durationMs: a.durationInMillis, url: a.url,
        },
        a.previews?.[0]?.url ? { kind: 'preview', url: a.previews[0].url, durationSec: 30, source: 'apple-music', via: 'alternate-search' } : null,
        { method: 'sdk', sdk: { service: 'apple-music', trackId: s.id, storefront }, requiresSubscription: true });
      }
    } catch { /* discovery is best-effort */ }
  }

  r.alternates = [...byProvider.values()];
}

// Optional fingerprint-grade confirmation (AudD / ACRCloud) — only when
// the owner configured keys AND an audio URL exists to check. Stamps
// r.identityVerification; never fails the resolve.
async function verifyIdentity(r) {
  if (!recognitionConfigured()) return;
  const audioUrl = r.audio?.url || r.alternates?.[0]?.audio?.url;
  if (!audioUrl) return;
  const rec = await recognizeAudioUrl(audioUrl);
  if (!rec) return;
  const m = scoreMatch({ name: r.name, artist: r.artist }, rec);
  r.identityVerification = {
    verifiedBy: rec.service,
    confidence: m.confidence,
    status: m.confidence >= 0.9 ? 'confirmed' : 'unconfirmed',
    recognized: { title: rec.title, artist: rec.artist },
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function resolveMusicLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new ResolveError('Missing url parameter', 'VALIDATION_ERROR');
  }
  let workingUrl = rawUrl.trim();
  let parsed = parseMusicLink(workingUrl);
  if (!parsed) throw unsupported(rawUrl);

  if (parsed.needsRedirect) {
    let finalUrl;
    try {
      finalUrl = await followRedirects(workingUrl);
    } catch (e) {
      throw new ResolveError(`Could not follow short link ${parsed.host}: ${e.message}`, 'UPSTREAM_ERROR');
    }
    parsed = parseMusicLink(finalUrl);
    if (!parsed || parsed.needsRedirect) throw unsupported(rawUrl);
    workingUrl = finalUrl;
  }

  const r = {
    provider: parsed.provider,
    type: parsed.type,
    id: parsed.id,
    name: '',
    artist: '',
    album: '',
    isrc: null,
    url: workingUrl,
    image: null,
    durationMs: null,
    audio: null,
    audioNote: null,
    playback: null,
    crossLinks: {},
    embedUrl: null,
    alternates: [],
    matchSummary: null,
    identityVerification: null,
  };
  if (parsed.storefront) r.storefront = parsed.storefront;
  if (parsed.type === 'album' || parsed.type === 'playlist') r.trackCount = null;

  try {
    switch (parsed.provider) {
      case 'spotify': await resolveSpotify(r, parsed, workingUrl); break;
      case 'apple-music': await resolveAppleMusic(r, parsed); break;
      case 'deezer': await resolveDeezer(r, parsed); break;
      case 'soundcloud': await resolveSoundCloud(r, parsed, workingUrl); break;
      case 'youtube':
      case 'youtube-music': await resolveYouTube(r, parsed, workingUrl); break;
      case 'audius': await resolveAudius(r, parsed, workingUrl); break;
      case 'tidal':
      case 'bandcamp': await resolveOgService(r, parsed, workingUrl); break;
      default: throw unsupported(rawUrl);
    }
  } catch (e) {
    if (e instanceof ResolveError) throw e;
    // Nothing resolvable: no name, no audio, no artwork → upstream failure.
    if (!r.name && !r.audio && !r.image) {
      throw new ResolveError(`Upstream lookup failed for ${parsed.provider}: ${e.message}`, 'UPSTREAM_ERROR');
    }
    if (!r.audioNote) r.audioNote = `Partial metadata only; upstream lookup was incomplete (${e.message}).`;
  }

  // Cross-platform identity (tracks and albums only — song.link's domain).
  if (parsed.type === 'track' || parsed.type === 'album' || parsed.type === 'video') {
    await fillCrossLinks(r, workingUrl);
  }

  // Playback ladder: best route to the FULL track (stream > sdk > embed >
  // preview floor). Computed before the ISRC preview step so a preview
  // cross-match can never outrank an sdk/embed route.
  r.playback = buildPlayback(r, parsed);

  // Audio ladder step (b): ISRC cross-match to a Deezer preview.
  if (!r.audio && r.isrc) {
    const preview = await deezerIsrcPreview(r.isrc, {
      name: r.name, artist: r.artist, isrc: r.isrc, durationMs: r.durationMs,
    });
    if (preview) {
      r.audio = preview;
      r.audioNote = `No native audio from ${parsed.provider}; 30s preview cross-matched on Deezer by ISRC.`;
    } else if (!r.audioNote) {
      r.audioNote = `No audio available from ${parsed.provider} and no ISRC match found on Deezer.`;
    } else if (!/ISRC/.test(r.audioNote)) {
      r.audioNote = `${r.audioNote} No ISRC cross-match preview was found either.`;
    }
  }

  // Alternate-service discovery + optional recognition confirmation.
  await findAlternates(r, parsed);
  await verifyIdentity(r);

  // If the ISRC step produced audio where playback had no route at all,
  // the playback floor becomes that audio.
  if (r.playback.method === 'none' && r.audio) {
    r.playback = {
      method: r.audio.kind === 'full' ? 'stream' : 'preview',
      streamUrl: r.audio.url,
      requiresSubscription: false,
    };
  }

  return r;
}

export default resolveMusicLink;
