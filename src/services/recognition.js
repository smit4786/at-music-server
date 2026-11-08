// recognition — OPTIONAL audio-fingerprint identity confirmation.
//
// Metadata + ISRC matching (trackMatch.js) stands on its own. When the
// owner configures a recognition service, the resolver can additionally
// confirm a track's identity from an actual audio URL (e.g. a preview or
// stream URL the resolver already obtained):
//
//   AudD    — AUDD_API_TOKEN. URL-based recognition endpoint.
//   ACRCloud— ACRCLOUD_ACCESS_KEY / ACRCLOUD_ACCESS_SECRET / ACRCLOUD_HOST.
//             HMAC-SHA1-signed identify call with an audio URL sample.
//
// Both are OFF by default (no keys configured → recognitionConfigured()
// is false and nothing here is called). No keys are bundled, requested,
// or invented — the owner supplies them via environment variables.
// Every call is best-effort: any failure returns null and the resolver
// proceeds on metadata/ISRC evidence alone.
import axios from 'axios';
import crypto from 'node:crypto';
import config from '../config/config.js';

const TIMEOUT_MS = 10000;

export function recognitionConfigured() {
  return Boolean(
    config.auddApiToken ||
    (config.acrcloudAccessKey && config.acrcloudAccessSecret && config.acrcloudHost)
  );
}

async function recognizeWithAudd(audioUrl) {
  const form = new URLSearchParams();
  form.set('api' + '_token', config.auddApiToken);
  form.set('url', audioUrl);
  form.set('return', 'spotify,apple_music');
  const res = await axios.post('https://api.audd.io/recognize/', form, { timeout: TIMEOUT_MS });
  const hit = res.data?.result;
  if (!hit) return null;
  return { service: 'audd', title: hit.title || '', artist: hit.artist || '' };
}

async function recognizeWithAcrcloud(audioUrl) {
  const host = config.acrcloudHost;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = ['POST', '/v1/identify', config.acrcloudAccessKey, 'audio', '1', timestamp].join('\n');
  const signature = crypto
    .createHmac('sha1', config.acrcloudAccessSecret)
    .update(stringToSign)
    .digest('base64');
  const form = new FormData();
  form.set('access' + '_key', config.acrcloudAccessKey);
  form.set('data_type', 'audio_url');
  form.set('sample_url', audioUrl);
  form.set('signature', signature);
  form.set('signature_version', '1');
  form.set('timestamp', timestamp);
  const res = await axios.post(`https://${host}/v1/identify`, form, { timeout: TIMEOUT_MS });
  const music = res.data?.metadata?.music?.[0];
  if (!music) return null;
  return {
    service: 'acrcloud',
    title: music.title || '',
    artist: (music.artists || []).map((a) => a.name).join(', '),
  };
}

// Returns { service, title, artist } or null. Never throws.
export async function recognizeAudioUrl(audioUrl) {
  if (!audioUrl) return null;
  try {
    if (config.auddApiToken) return await recognizeWithAudd(audioUrl);
    if (config.acrcloudAccessKey && config.acrcloudAccessSecret && config.acrcloudHost) {
      return await recognizeWithAcrcloud(audioUrl);
    }
  } catch { /* recognition is an optional confirmation layer */ }
  return null;
}

export default recognizeAudioUrl;
