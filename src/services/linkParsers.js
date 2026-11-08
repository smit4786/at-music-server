// linkParsers — PURE parser for music-service links. No network, no I/O.
// parseMusicLink(url) → { provider, type, id, storefront? } for a direct
// link, { provider: null, type: null, id: null, needsRedirect: true, host }
// for a known short-link host (resolve the redirect first), or null when the
// URL is not a recognized music link.
//
// type ∈ track | album | playlist | artist | episode | video
// ('video' is used for YouTube links; every other service uses track-level
// types from the list above.)

const SHORT_LINK_HOSTS = new Set([
  'spotify.link',
  'on.soundcloud.com',
  'deezer.page.link',
  'link.deezer.com',
]);

function result(provider, type, id, extra = {}) {
  if (!id) return null;
  return { provider, type, id, ...extra };
}

function parseSpotify(u) {
  // spotify:track:<id> style URIs
  if (u.protocol === 'spotify:') {
    const parts = u.pathname.split(':').filter(Boolean);
    // pathname for "spotify:track:ID" is "track:ID"
    const seg = u.href.split(':');
    if (seg.length >= 3) {
      const [, type, id] = seg;
      if (['track', 'album', 'playlist', 'artist', 'episode'].includes(type)) {
        return result('spotify', type, id);
      }
    }
    if (parts.length >= 2) return null;
    return null;
  }
  const seg = u.pathname.split('/').filter(Boolean);
  // Optional locale prefix: /intl-xx/ or /intl-xx-YY/
  if (seg[0] && /^intl-[a-z]{2}(-[a-z]{2})?$/i.test(seg[0])) seg.shift();
  const [type, id] = seg;
  if (['track', 'album', 'playlist', 'artist', 'episode'].includes(type)) {
    return result('spotify', type, id);
  }
  return null;
}

function parseAppleMusic(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length < 2) return null;
  const storefront = seg[0].toLowerCase();
  const kind = seg[1];
  // Track deep link on an album page: /{cc}/album/{slug}/{albumId}?i={trackId}
  const trackId = u.searchParams.get('i');
  if (kind === 'album' && trackId) {
    return result('apple-music', 'track', trackId, { storefront });
  }
  if (kind === 'song' && seg[3]) return result('apple-music', 'track', seg[3], { storefront });
  if (kind === 'album' && seg[3]) return result('apple-music', 'album', seg[3], { storefront });
  if (kind === 'playlist' && seg[3]) return result('apple-music', 'playlist', seg[3], { storefront });
  if (kind === 'artist' && seg[3]) return result('apple-music', 'artist', seg[3], { storefront });
  // music.apple.com/{cc}/... short/search forms carry no stable entity id.
  return null;
}

function parseSoundCloud(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length === 2) {
    // /{user}/{track-slug} — id is the canonical path; SoundCloud has no numeric public id in the URL.
    return result('soundcloud', 'track', seg.join('/'));
  }
  if (seg.length === 3 && seg[1] === 'sets') {
    return result('soundcloud', 'playlist', seg.join('/'));
  }
  return null;
}

function parseYouTube(u, provider) {
  const v = u.searchParams.get('v');
  if (u.pathname === '/watch' && v) return result(provider, 'video', v);
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg[0] === 'shorts' && seg[1]) return result(provider, 'video', seg[1]);
  if (u.hostname === 'youtu.be' && seg[0]) return result(provider, 'video', seg[0]);
  return null;
}

function parseDeezer(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  // Optional country prefix: /{cc}/track/{id}
  if (seg.length === 3 && /^[a-z]{2}$/i.test(seg[0])) seg.shift();
  const [type, id] = seg;
  if (['track', 'album', 'playlist'].includes(type) && /^\d+$/.test(id || '')) {
    return result('deezer', type, id);
  }
  return null;
}

function parseTidal(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg[0] === 'browse') seg.shift();
  const [type, id] = seg;
  if (['track', 'album', 'playlist'].includes(type) && id) {
    return result('tidal', type, id);
  }
  return null;
}

function parseBandcamp(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  const [type, slug] = seg;
  if ((type === 'track' || type === 'album') && slug) {
    return result('bandcamp', type, `${u.hostname}/${type}/${slug}`);
  }
  return null;
}

function parseAudius(u) {
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length === 2) return result('audius', 'track', seg.join('/'));
  return null;
}

export function parseMusicLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }

  if (u.protocol === 'spotify:') return parseSpotify(u);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (SHORT_LINK_HOSTS.has(host)) {
    return { provider: null, type: null, id: null, needsRedirect: true, host };
  }

  switch (host) {
    case 'open.spotify.com':
      return parseSpotify(u);
    case 'music.apple.com':
      return parseAppleMusic(u);
    case 'soundcloud.com':
      return parseSoundCloud(u);
    case 'youtube.com':
    case 'm.youtube.com':
    case 'music.youtube.com':
      return parseYouTube(u, host === 'music.youtube.com' ? 'youtube-music' : 'youtube');
    case 'youtu.be':
      return parseYouTube(u, 'youtube');
    case 'deezer.com':
      return parseDeezer(u);
    case 'tidal.com':
    case 'listen.tidal.com':
      return parseTidal(u);
    case 'audius.co':
      return parseAudius(u);
    default:
      if (host.endsWith('.bandcamp.com')) return parseBandcamp(u);
      return null;
  }
}

export default parseMusicLink;
