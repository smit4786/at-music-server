import { jest } from '@jest/globals';

const mockAxios = { get: jest.fn(), post: jest.fn() };

jest.unstable_mockModule('axios', () => ({ default: mockAxios }));

const fakeConfig = {
  spotifyClientId: 'test-client-id',
  spotifyClientSecret: 'test-client-secret',
  appleMusicDeveloperToken: '',
  soundcloudClientId: '',
  jwtSecret: 'test',
  nodeEnv: 'test',
};
jest.unstable_mockModule('../src/config/config.js', () => ({
  default: fakeConfig,
  config: fakeConfig,
}));

const { resolveMusicLink } = await import('../src/services/linkResolver.js');

function routeGet(handler) {
  mockAxios.get.mockImplementation(async (url) => ({ data: handler(url) }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAxios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
});

describe('resolveMusicLink — Spotify with a native preview', () => {
  test('returns metadata + spotify preview audio', async () => {
    routeGet((url) => {
      if (url.includes('api.spotify.com/v1/tracks/')) {
        return {
          name: 'Song A', artists: [{ name: 'Artist A' }],
          album: { name: 'Album A', images: [{ url: 'https://img/a.jpg' }] },
          external_ids: { isrc: 'ISRC001' }, duration_ms: 200000,
          preview_url: 'https://cdn/preview-a.mp3',
          external_urls: { spotify: 'https://open.spotify.com/track/AAA' },
        };
      }
      if (url.includes('api.song.link')) {
        return { linksByPlatform: { deezer: { url: 'https://www.deezer.com/track/42' } }, entitiesByUniqueId: {} };
      }
      throw new Error(`unexpected GET ${url}`);
    });

    const r = await resolveMusicLink('https://open.spotify.com/track/AAA');
    expect(r.provider).toBe('spotify');
    expect(r.name).toBe('Song A');
    expect(r.artist).toBe('Artist A');
    expect(r.isrc).toBe('ISRC001');
    expect(r.audio).toEqual({
      kind: 'preview', url: 'https://cdn/preview-a.mp3', durationSec: 30, source: 'spotify', via: 'native',
    });
    expect(r.crossLinks.deezer).toBe('https://www.deezer.com/track/42');
    // Full-track route is the Spotify SDK under the user's own subscription —
    // the preview stays in `audio` but is NOT the primary playback.
    expect(r.playback).toEqual({
      method: 'sdk',
      sdk: { service: 'spotify', trackId: 'AAA', uri: 'spotify:track:AAA' },
      requiresSubscription: true,
    });
  });
});

describe('resolveMusicLink — Spotify without a preview falls back via ISRC', () => {
  test('deezer ISRC cross-match supplies the preview', async () => {
    routeGet((url) => {
      if (url.includes('api.spotify.com/v1/tracks/')) {
        return {
          name: 'Song B', artists: [{ name: 'Artist B' }],
          album: { name: 'Album B', images: [] },
          external_ids: { isrc: 'ISRC002' }, duration_ms: 180000,
          preview_url: null,
          external_urls: { spotify: 'https://open.spotify.com/track/BBB' },
        };
      }
      if (url.includes('api.song.link')) throw new Error('song.link down');
      if (url.includes('api.deezer.com/track/isrc:')) {
        return { preview: 'https://cdn/dz-preview-b.mp3' };
      }
      throw new Error(`unexpected GET ${url}`);
    });

    const r = await resolveMusicLink('https://open.spotify.com/track/BBB');
    expect(r.audio).toEqual({
      kind: 'preview', url: 'https://cdn/dz-preview-b.mp3', durationSec: 30, source: 'deezer', via: 'isrc-cross-match',
    });
    expect(r.audioNote).toMatch(/ISRC/);
    // song.link failing must not fail the resolve:
    expect(r.crossLinks).toEqual({});
  });
});

describe('resolveMusicLink — Deezer direct', () => {
  test('public API metadata + preview', async () => {
    routeGet((url) => {
      if (url.includes('api.deezer.com/track/1109731')) {
        return {
          title: 'Dz Song', artist: { name: 'Dz Artist' },
          album: { title: 'Dz Album', cover_xl: 'https://img/dz.jpg' },
          isrc: 'ISRC003', duration: 183, preview: 'https://cdn/dz.mp3',
          link: 'https://www.deezer.com/track/1109731',
        };
      }
      if (url.includes('api.song.link')) return { linksByPlatform: {}, entitiesByUniqueId: {} };
      throw new Error(`unexpected GET ${url}`);
    });

    const r = await resolveMusicLink('https://www.deezer.com/track/1109731');
    expect(r.provider).toBe('deezer');
    expect(r.name).toBe('Dz Song');
    expect(r.playback).toEqual({
      method: 'embed',
      embedUrl: 'https://widget.deezer.com/widget/dark/track/1109731',
      requiresSubscription: false,
    });
    expect(r.durationMs).toBe(183000);
    expect(r.audio).toEqual({
      kind: 'preview', url: 'https://cdn/dz.mp3', durationSec: 30, source: 'deezer', via: 'native',
    });
  });
});

describe('resolveMusicLink — YouTube is embed-only', () => {
  test('metadata via oEmbed, audio null with a licensing note', async () => {
    routeGet((url) => {
      if (url.includes('youtube.com/oembed')) {
        return { title: 'YT Title', author_name: 'YT Channel', thumbnail_url: 'https://img/yt.jpg' };
      }
      if (url.includes('api.song.link')) return { linksByPlatform: {}, entitiesByUniqueId: {} };
      throw new Error(`unexpected GET ${url}`);
    });

    const r = await resolveMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(r.name).toBe('YT Title');
    expect(r.audio).toBeNull();
    expect(r.audioNote).toMatch(/embed/i);
    expect(r.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(r.playback.method).toBe('embed');
    expect(r.playback.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(r.playback.sdk).toEqual({ service: 'youtube', trackId: 'dQw4w9WgXcQ' });
    expect(r.playback.requiresSubscription).toBe(false);
  });
});

describe('resolveMusicLink — Apple Music playback is MusicKit SDK', () => {
  test('parse-only server side, sdk playback with storefront', async () => {
    routeGet((url) => {
      if (url.includes('api.song.link')) return { linksByPlatform: {}, entitiesByUniqueId: {} };
      throw new Error(`unexpected GET ${url}`);
    });

    const r = await resolveMusicLink('https://music.apple.com/us/album/thriller/269572838?i=269573364');
    expect(r.provider).toBe('apple-music');
    expect(r.audio).toBeNull();
    expect(r.audioNote).toMatch(/developer token/i);
    expect(r.playback).toEqual({
      method: 'sdk',
      sdk: { service: 'apple-music', trackId: '269573364', storefront: 'us' },
      requiresSubscription: true,
    });
  });
});

describe('resolveMusicLink — Audius playback is a full stream', () => {
  test('stream method with the discovery-provider stream URL', async () => {
    routeGet((url) => {
      if (url.includes('discoveryprovider.audius.co/v1/resolve')) {
        return {
          data: {
            id: 'eYRWn', title: 'Audius Song', user: { name: 'Audius Artist' },
            duration: 200, artwork: { '480x480': 'https://img/au.jpg' },
          },
        };
      }
      if (url.includes('api.song.link')) return { linksByPlatform: {}, entitiesByUniqueId: {} };
      throw new Error(`unexpected GET ${url}`);
    });

    const r = await resolveMusicLink('https://audius.co/somehandle/some-track');
    expect(r.audio.kind).toBe('full');
    expect(r.playback.method).toBe('stream');
    expect(r.playback.streamUrl).toContain('/v1/tracks/eYRWn/stream');
    expect(r.playback.requiresSubscription).toBe(false);
  });
});

describe('resolveMusicLink — errors', () => {
  test('unsupported link → UNSUPPORTED_LINK', async () => {
    await expect(resolveMusicLink('https://example.com/song/1'))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_LINK' });
  });
  test('missing url → VALIDATION_ERROR', async () => {
    await expect(resolveMusicLink('')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(resolveMusicLink(undefined)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
