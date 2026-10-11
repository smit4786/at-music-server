import { LastFmProvider } from './LastFmProvider.js';
import { AppleMusicProvider } from './AppleMusicProvider.js';
import { SpotifyProvider } from './SpotifyProvider.js';

const registry = new Map();

export function registerProvider(provider) {
  registry.set(provider.name, provider);
}

export function getProvider(name) {
  const p = registry.get(name);
  if (!p) throw new Error(`Unknown music provider: ${name}`);
  return p;
}

export function listProviders() {
  return [...registry.keys()];
}

// Register built-in providers. New providers: implement MusicProvider,
// import here, and call registerProvider.
registerProvider(new LastFmProvider());
registerProvider(new AppleMusicProvider());
registerProvider(new SpotifyProvider());
