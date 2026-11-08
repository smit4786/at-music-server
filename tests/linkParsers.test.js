import { parseMusicLink } from '../src/services/linkParsers.js';

describe('parseMusicLink — Spotify', () => {
  test('track', () => {
    expect(parseMusicLink('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'))
      .toEqual({ provider: 'spotify', type: 'track', id: '4uLU6hMCjMI75M1A2tKUQC' });
  });
  test('intl- prefix is stripped', () => {
    expect(parseMusicLink('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=abc'))
      .toEqual({ provider: 'spotify', type: 'track', id: '4uLU6hMCjMI75M1A2tKUQC' });
    expect(parseMusicLink('https://open.spotify.com/intl-pt-br/album/1ATL5GLyefJaxhQzSPVrLX'))
      .toEqual({ provider: 'spotify', type: 'album', id: '1ATL5GLyefJaxhQzSPVrLX' });
  });
  test('spotify: URIs', () => {
    expect(parseMusicLink('spotify:track:4uLU6hMCjMI75M1A2tKUQC'))
      .toEqual({ provider: 'spotify', type: 'track', id: '4uLU6hMCjMI75M1A2tKUQC' });
    expect(parseMusicLink('spotify:episode:512ojhOuo1ktJprKbVcKyQ'))
      .toEqual({ provider: 'spotify', type: 'episode', id: '512ojhOuo1ktJprKbVcKyQ' });
  });
  test('playlist and artist', () => {
    expect(parseMusicLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')?.type).toBe('playlist');
    expect(parseMusicLink('https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02')?.type).toBe('artist');
  });
});

describe('parseMusicLink — Apple Music', () => {
  test('album URL with ?i= resolves to the track', () => {
    expect(parseMusicLink('https://music.apple.com/us/album/thriller/269572838?i=269573364'))
      .toEqual({ provider: 'apple-music', type: 'track', id: '269573364', storefront: 'us' });
  });
  test('song path', () => {
    expect(parseMusicLink('https://music.apple.com/us/song/billie-jean/269573364'))
      .toEqual({ provider: 'apple-music', type: 'track', id: '269573364', storefront: 'us' });
  });
  test('album, playlist, artist keep the storefront', () => {
    expect(parseMusicLink('https://music.apple.com/gb/album/thriller/269572838'))
      .toEqual({ provider: 'apple-music', type: 'album', id: '269572838', storefront: 'gb' });
    expect(parseMusicLink('https://music.apple.com/us/playlist/todays-hits/pl.11111111111111111111111111111111')?.type).toBe('playlist');
    expect(parseMusicLink('https://music.apple.com/us/artist/michael-jackson/32940')?.type).toBe('artist');
  });
});

describe('parseMusicLink — SoundCloud', () => {
  test('track path becomes the id', () => {
    expect(parseMusicLink('https://soundcloud.com/some-artist/some-track'))
      .toEqual({ provider: 'soundcloud', type: 'track', id: 'some-artist/some-track' });
  });
  test('sets are playlists', () => {
    expect(parseMusicLink('https://soundcloud.com/some-artist/sets/some-mix'))
      .toEqual({ provider: 'soundcloud', type: 'playlist', id: 'some-artist/sets/some-mix' });
  });
});

describe('parseMusicLink — YouTube', () => {
  test('watch URL', () => {
    expect(parseMusicLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toEqual({ provider: 'youtube', type: 'video', id: 'dQw4w9WgXcQ' });
  });
  test('youtu.be short URL', () => {
    expect(parseMusicLink('https://youtu.be/dQw4w9WgXcQ?si=xyz'))
      .toEqual({ provider: 'youtube', type: 'video', id: 'dQw4w9WgXcQ' });
  });
  test('shorts', () => {
    expect(parseMusicLink('https://www.youtube.com/shorts/aqz-KE-bpKQ')?.id).toBe('aqz-KE-bpKQ');
  });
  test('YouTube Music host', () => {
    expect(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toEqual({ provider: 'youtube-music', type: 'video', id: 'dQw4w9WgXcQ' });
  });
});

describe('parseMusicLink — Deezer / Tidal / Bandcamp / Audius', () => {
  test('deezer with and without country prefix', () => {
    expect(parseMusicLink('https://www.deezer.com/track/1109731'))
      .toEqual({ provider: 'deezer', type: 'track', id: '1109731' });
    expect(parseMusicLink('https://www.deezer.com/us/album/302127'))
      .toEqual({ provider: 'deezer', type: 'album', id: '302127' });
    expect(parseMusicLink('https://www.deezer.com/playlist/908622995')?.type).toBe('playlist');
  });
  test('tidal browse and bare forms', () => {
    expect(parseMusicLink('https://tidal.com/browse/track/17985563'))
      .toEqual({ provider: 'tidal', type: 'track', id: '17985563' });
    expect(parseMusicLink('https://tidal.com/track/17985563')?.type).toBe('track');
    expect(parseMusicLink('https://listen.tidal.com/album/17985562')?.type).toBe('album');
  });
  test('bandcamp subdomains', () => {
    expect(parseMusicLink('https://someartist.bandcamp.com/track/a-track'))
      .toEqual({ provider: 'bandcamp', type: 'track', id: 'someartist.bandcamp.com/track/a-track' });
    expect(parseMusicLink('https://someartist.bandcamp.com/album/an-album')?.type).toBe('album');
  });
  test('audius', () => {
    expect(parseMusicLink('https://audius.co/somehandle/some-track-123'))
      .toEqual({ provider: 'audius', type: 'track', id: 'somehandle/some-track-123' });
  });
});

describe('parseMusicLink — short links and rejections', () => {
  test.each([
    ['https://spotify.link/AbCdEf', 'spotify.link'],
    ['https://on.soundcloud.com/xYz12', 'on.soundcloud.com'],
    ['https://deezer.page.link/AbCd', 'deezer.page.link'],
    ['https://link.deezer.com/s/abc123', 'link.deezer.com'],
  ])('%s is flagged needsRedirect', (url, host) => {
    const p = parseMusicLink(url);
    expect(p).toMatchObject({ needsRedirect: true, host });
  });

  test.each([
    'https://example.com/track/123',
    'https://www.google.com/search?q=music',
    'https://open.spotify.com/',
    'https://open.spotify.com/collection/tracks',
    'not a url',
    '',
    'ftp://open.spotify.com/track/abc',
  ])('rejects %s', (url) => {
    expect(parseMusicLink(url)).toBeNull();
  });

  test('rejects null/undefined', () => {
    expect(parseMusicLink(null)).toBeNull();
    expect(parseMusicLink(undefined)).toBeNull();
  });
});
