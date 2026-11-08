// trackMatch — PURE recording-identity scoring. No network, no I/O.
//
// scoreMatch(source, candidate) answers: "are these two metadata records
// the same recording?" Candidates look like
//   { name|title, artist, isrc, durationMs }
// (durationSec is also accepted). Returns:
//   { confidence: 0..1, verifiedBy: 'isrc' | 'metadata', basis: [...] }
//
// Signals:
//   - ISRC equality is decisive: same ISRC → 1.0. Conflicting ISRCs cap
//     the score at 0.6 (different ISRC = usually a different recording,
//     e.g. a remaster — metadata alone cannot override that).
//   - Title: token-set similarity after normalization (feat./ft. clauses,
//     bracketed tags, and version suffixes like "- Live" / "- Remastered"
//     are stripped before comparison).
//   - Artist: token-set similarity after normalization.
//   - Duration: ±2s full credit, ±5s partial (0.5), otherwise 0; unknown
//     duration on either side is NEUTRAL (excluded, weights renormalize).
//
// Caps that keep weak evidence honest:
//   - If the artist signal is unavailable, confidence caps at 0.89 — a
//     title alone cannot verify (karaoke/cover versions share titles).
//   - If title similarity < 0.5, confidence caps at 0.69.
//
// Thresholds (used by the resolver):
//   >= 0.90 'verified' · 0.70–0.89 'probable' · < 0.70 rejected.

const TITLE_W = 0.45;
const ARTIST_W = 0.35;
const DURATION_W = 0.2;

const VERSION_WORDS = new Set([
  'live', 'remaster', 'remastered', 'remix', 'acoustic', 'instrumental',
  'version', 'edit', 'radio', 'extended', 'mono', 'stereo', 'deluxe',
  'bonus', 'demo', 'reprise', 'session', 'sessions', 'cover',
]);

function stripVersionSuffix(s) {
  // "Song - Live at Wembley" / "Song (Remastered 2011)" → "Song"
  let out = s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ');
  const dash = out.split(/\s+-\s+/);
  if (dash.length > 1) {
    const tail = dash.slice(1).join(' ').toLowerCase();
    if ([...VERSION_WORDS].some((w) => tail.includes(w))) out = dash[0];
  }
  return out;
}

export function titleTokens(name) {
  if (!name) return new Set();
  let s = String(name).toLowerCase();
  s = s.replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, ''); // drop the guest clause
  s = stripVersionSuffix(s);
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  return new Set(s.split(/\s+/).filter(Boolean));
}

export function artistTokens(artist) {
  if (!artist) return new Set();
  const s = String(artist).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return new Set(s.split(/\s+/).filter((t) => t && t !== 'the'));
}

function tokenSimilarity(a, b) {
  if (!a.size || !b.size) return null;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const jaccard = inter / (a.size + b.size - inter);
  // Containment (one side's tokens all inside the other's) is stronger
  // evidence than raw Jaccard for short titles.
  const containment = inter / Math.min(a.size, b.size);
  return Math.max(jaccard, containment >= 1 ? Math.max(jaccard, 0.9) : jaccard);
}

function durationCredit(aMs, bMs) {
  if (aMs == null || bMs == null) return null;
  const diffSec = Math.abs(aMs - bMs) / 1000;
  if (diffSec <= 2) return 1;
  if (diffSec <= 5) return 0.5;
  return 0;
}

function normIsrc(v) {
  return v ? String(v).replace(/[^a-z0-9]/gi, '').toUpperCase() : null;
}

function durationMsOf(t) {
  if (t.durationMs != null) return t.durationMs;
  if (t.durationSec != null) return t.durationSec * 1000;
  if (t.duration != null) return t.duration * 1000; // Deezer-style seconds
  return null;
}

export function scoreMatch(source, candidate) {
  const sIsrc = normIsrc(source.isrc);
  const cIsrc = normIsrc(candidate.isrc);
  if (sIsrc && cIsrc && sIsrc === cIsrc) {
    return { confidence: 1, verifiedBy: 'isrc', basis: ['isrc'] };
  }

  const titleSim = tokenSimilarity(
    titleTokens(source.name ?? source.title),
    titleTokens(candidate.name ?? candidate.title)
  );
  const artistSim = tokenSimilarity(
    artistTokens(source.artist),
    artistTokens(candidate.artist)
  );
  const durCredit = durationCredit(durationMsOf(source), durationMsOf(candidate));

  const parts = [];
  if (titleSim != null) parts.push({ w: TITLE_W, v: titleSim, key: 'title', agreed: titleSim >= 0.8 });
  if (artistSim != null) parts.push({ w: ARTIST_W, v: artistSim, key: 'artist', agreed: artistSim >= 0.8 });
  if (durCredit != null) parts.push({ w: DURATION_W, v: durCredit, key: 'duration', agreed: durCredit === 1 });

  if (!parts.length) {
    return { confidence: 0, verifiedBy: 'metadata', basis: [] };
  }
  const totalW = parts.reduce((acc, p) => acc + p.w, 0);
  let confidence = parts.reduce((acc, p) => acc + p.w * p.v, 0) / totalW;
  const basis = parts.filter((p) => p.agreed).map((p) => p.key);

  if (artistSim == null) confidence = Math.min(confidence, 0.89);
  if (titleSim != null && titleSim < 0.5) confidence = Math.min(confidence, 0.69);
  if (sIsrc && cIsrc && sIsrc !== cIsrc) {
    confidence = Math.min(confidence, 0.6);
    basis.push('isrc-mismatch');
  }

  return {
    confidence: Math.round(confidence * 100) / 100,
    verifiedBy: 'metadata',
    basis,
  };
}

export function classifyMatch(score) {
  const c = typeof score === 'number' ? score : score.confidence;
  if (c >= 0.9) return 'verified';
  if (c >= 0.7) return 'probable';
  return 'rejected';
}

export default scoreMatch;
