// MusicProvider — common interface for all music data sources.
// Adding a new provider (Spotify, YouTube Music) means implementing these
// four methods and registering in providers/index.js. Routes never change.
export class MusicProvider {
  constructor(name) {
    this.name = name;
  }
  async searchTracks(term, opts) { throw new Error(`${this.name}: searchTracks not implemented`); }
  async getRecentTracks(username, opts) { throw new Error(`${this.name}: getRecentTracks not implemented`); }
  async getTopArtists(username, opts) { throw new Error(`${this.name}: getTopArtists not implemented`); }
  async lookupByIsrc(isrc, opts) { throw new Error(`${this.name}: lookupByIsrc not implemented`); }
}

// Standardized track shape returned by every provider. Providers map their
// native response into this before returning.
export function normalizeTrack(raw) {
  return {
    id: raw.id || raw.mbid || null,
    name: raw.name || raw.title || '',
    artist: raw.artist?.name || raw.artist || '',
    album: raw.album?.name || raw.album || '',
    isrc: raw.isrc || null,
    url: raw.url || null,
    image: raw.image?.[3]?.['#text'] || raw.artwork?.url || null,
    playedAt: raw.date?.uts ? new Date(raw.date.uts * 1000).toISOString() : null,
  };
}
