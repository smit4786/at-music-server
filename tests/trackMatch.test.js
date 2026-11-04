import { scoreMatch, classifyMatch } from '../src/services/trackMatch.js';

const base = { name: 'Lose Yourself', artist: 'Eminem', isrc: 'USIR10211559', durationMs: 326000 };

describe('scoreMatch — ISRC', () => {
  test('exact ISRC match is decisive even if metadata differs slightly', () => {
    const m = scoreMatch(base, { name: 'Lose Yourself', artist: 'Eminem', isrc: 'usir10211559', durationMs: 320000 });
    expect(m.confidence).toBe(1);
    expect(m.verifiedBy).toBe('isrc');
    expect(m.basis).toContain('isrc');
    expect(classifyMatch(m)).toBe('verified');
  });
  test('conflicting ISRCs cap the score (remaster/different recording)', () => {
    const m = scoreMatch(base, { name: 'Lose Yourself', artist: 'Eminem', isrc: 'USIR19999999', durationMs: 326000 });
    expect(m.confidence).toBeLessThanOrEqual(0.6);
    expect(m.basis).toContain('isrc-mismatch');
  });
});

describe('scoreMatch — metadata fuzzy matching', () => {
  test('same title/artist/duration verifies on metadata', () => {
    const m = scoreMatch(
      { name: 'Billie Jean', artist: 'Michael Jackson', durationMs: 294000 },
      { name: 'Billie Jean', artist: 'Michael Jackson', durationMs: 295000 }
    );
    expect(m.confidence).toBeGreaterThanOrEqual(0.9);
    expect(m.verifiedBy).toBe('metadata');
    expect(m.basis).toEqual(expect.arrayContaining(['title', 'artist', 'duration']));
  });
  test('featuring-suffix variants still match', () => {
    const m = scoreMatch(
      { name: 'Old Town Road', artist: 'Lil Nas X', durationMs: 157000 },
      { name: 'Old Town Road (feat. Billy Ray Cyrus)', artist: 'Lil Nas X feat. Billy Ray Cyrus', durationMs: 157000 }
    );
    expect(m.confidence).toBeGreaterThanOrEqual(0.85);
  });
  test('live/remaster suffix with duration drift lands in probable, not verified', () => {
    const m = scoreMatch(
      { name: 'Hotel California', artist: 'Eagles', durationMs: 390000 },
      { name: 'Hotel California - Live at the Forum, 1976', artist: 'Eagles', durationMs: 425000 }
    );
    expect(m.confidence).toBeGreaterThanOrEqual(0.7);
    expect(m.confidence).toBeLessThan(0.95);
    expect(classifyMatch(m)).not.toBe('rejected');
  });
  test('duration ±5s earns partial credit, ±30s earns none', () => {
    const near = scoreMatch(
      { name: 'Song', artist: 'Artist', durationMs: 200000 },
      { name: 'Song', artist: 'Artist', durationMs: 204000 }
    );
    const far = scoreMatch(
      { name: 'Song', artist: 'Artist', durationMs: 200000 },
      { name: 'Song', artist: 'Artist', durationMs: 230000 }
    );
    expect(near.confidence).toBeGreaterThan(far.confidence);
  });
  test('unknown duration is neutral, not zero', () => {
    const m = scoreMatch(
      { name: 'Song', artist: 'Artist' },
      { name: 'Song', artist: 'Artist', durationMs: 999000 }
    );
    expect(m.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('scoreMatch — rejections', () => {
  test('wrong track is rejected', () => {
    const m = scoreMatch(base, { name: 'Stan', artist: 'Eminem', durationMs: 404000 });
    expect(m.confidence).toBeLessThan(0.7);
    expect(classifyMatch(m)).toBe('rejected');
  });
  test('cover-version trap: same title, different artist scores low', () => {
    const m = scoreMatch(
      { name: 'Hallelujah', artist: 'Leonard Cohen', durationMs: 282000 },
      { name: 'Hallelujah', artist: 'Pentatonix', durationMs: 282000 }
    );
    expect(m.confidence).toBeLessThan(0.7);
    expect(classifyMatch(m)).toBe('rejected');
  });
  test('karaoke trap: same title with no source artist caps below verified', () => {
    const m = scoreMatch(
      { name: 'Never Gonna Give You Up', artist: '', durationMs: null },
      { name: 'Never Gonna Give You Up', artist: 'Karaoke All Stars', durationMs: 213000 }
    );
    expect(m.confidence).toBeLessThanOrEqual(0.89);
  });
  test('no comparable signals scores zero', () => {
    const m = scoreMatch({ name: '', artist: '' }, { name: '', artist: '' });
    expect(m.confidence).toBe(0);
  });
});
