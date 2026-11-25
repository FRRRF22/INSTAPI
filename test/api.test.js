import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { ProviderError } from '../src/provider.js';

function startTestServer(t, allowAllOrigins = false) {
  const provider = {
    configured: false,
    async extractMedia() {
      throw new ProviderError('provider not configured', 503, 'PROVIDER_NOT_CONFIGURED');
    },
    async getProfile() {
      throw new ProviderError('provider not configured', 503, 'PROVIDER_NOT_CONFIGURED');
    },
  };
  const config = {
    trustProxyHops: 0,
    allowAllOrigins,
    frontendOrigins: new Set(['https://allowed-site.example']),
    maxVideoBytes: 1024 * 1024,
    maxImageBytes: 1024 * 1024,
    allowedMediaHosts: new Set(),
  };
  const downloadStore = { get: () => null };
  const server = createApp({ config, provider, downloadStore }).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return new Promise((resolve) => server.once('listening', () => {
    resolve(`http://127.0.0.1:${server.address().port}`);
  }));
}

test('health route exposes readiness without leaking secrets', async (t) => {
  const base = await startTestServer(t);
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', providerConfigured: false });
});

test('extract route rejects unsupported hosts before contacting the provider', async (t) => {
  const base = await startTestServer(t);
  const response = await fetch(`${base}/api/v1/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/reel/abc/', confirmRights: true }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_INSTAGRAM_URL');
});

test('valid supported links return a clear provider setup error until configured', async (t) => {
  const base = await startTestServer(t);
  const response = await fetch(`${base}/api/v1/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.instagram.com/reel/abc123/', confirmRights: true }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'PROVIDER_NOT_CONFIGURED');
});

test('CORS rejects unlisted web origins', async (t) => {
  const base = await startTestServer(t);
  const response = await fetch(`${base}/health`, { headers: { origin: 'https://unlisted-site.example' } });
  assert.equal(response.status, 403);
});

test('wildcard CORS allows any origin without enabling credentials', async (t) => {
  const base = await startTestServer(t, true);
  const response = await fetch(`${base}/health`, { headers: { origin: 'https://another-site.example' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});
