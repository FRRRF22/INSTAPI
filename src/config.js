import 'dotenv/config';

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = new URL(entry);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        throw new Error('FRONTEND_ORIGINS must contain HTTPS origins (localhost is allowed for development).');
      }
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Each FRONTEND_ORIGINS entry must be an origin only.');
      }
      return url.origin;
    });
}

function parsePath(value, fallback) {
  const path = String(value || fallback).trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || /[?#\s\\]/.test(path)) {
    throw new Error('Extractor paths must be safe absolute paths, such as /v1/extract.');
  }
  return path;
}

function integer(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

const baseValue = process.env.EXTRACTOR_API_BASE_URL?.trim();
let extractorBaseUrl = null;
if (baseValue) {
  const parsed = new URL(baseValue);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    throw new Error('EXTRACTOR_API_BASE_URL must use HTTPS (localhost is allowed for development).');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('EXTRACTOR_API_BASE_URL must not contain credentials, a query, or a fragment.');
  }
  extractorBaseUrl = parsed.toString().replace(/\/$/, '');
}

const mediaHosts = String(process.env.ALLOWED_MEDIA_HOSTS || '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
for (const host of mediaHosts) {
  if (host.includes('*') || host.includes('/') || host.includes(':') || host.includes('@')) {
    throw new Error('ALLOWED_MEDIA_HOSTS accepts exact hostnames only; wildcards, ports, and paths are forbidden.');
  }
}

const frontendOriginsSetting = (process.env.FRONTEND_ORIGINS || '*').trim();
const allowAllOrigins = frontendOriginsSetting === '*';
if (frontendOriginsSetting.includes('*') && !allowAllOrigins) {
  throw new Error('Use FRONTEND_ORIGINS=* by itself to allow all origins, or provide an explicit comma-separated list.');
}

const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: integer('PORT', 3000, 1024, 65535),
  allowAllOrigins,
  frontendOrigins: new Set(allowAllOrigins ? [] : parseOrigins(frontendOriginsSetting)),
  trustProxyHops: integer('TRUST_PROXY_HOPS', 0, 0, 5),
  extractorBaseUrl,
  extractorApiKey: process.env.EXTRACTOR_API_KEY?.trim() || null,
  extractorExtractPath: parsePath(process.env.EXTRACTOR_EXTRACT_PATH, '/v1/extract'),
  extractorProfilePath: parsePath(process.env.EXTRACTOR_PROFILE_PATH, '/v1/profile'),
  extractorTimeoutMs: integer('EXTRACTOR_TIMEOUT_MS', 15000, 1000, 60000),
  allowedMediaHosts: new Set(mediaHosts),
  downloadLinkTtlSeconds: integer('DOWNLOAD_LINK_TTL_SECONDS', 600, 60, 1800),
  maxVideoBytes: integer('MAX_VIDEO_BYTES', 262144000, 1048576, 1073741824),
  maxImageBytes: integer('MAX_IMAGE_BYTES', 12582912, 1048576, 52428800),
});

export default config;
