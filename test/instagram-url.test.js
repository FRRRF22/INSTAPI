import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInstagramMediaUrl, parseInstagramProfileUrl } from '../src/instagram-url.js';

test('accepts and canonicalizes Reel links', () => {
  assert.deepEqual(parseInstagramMediaUrl('https://www.instagram.com/reel/ABC_123/?utm_source=copy'), {
    kind: 'media', mediaType: 'reel', shortcode: 'ABC_123', canonicalUrl: 'https://www.instagram.com/reel/ABC_123/',
  });
});

test('accepts IGTV and regular video post paths', () => {
  assert.equal(parseInstagramMediaUrl('https://instagram.com/tv/AbCdEf/').mediaType, 'igtv');
  assert.equal(parseInstagramMediaUrl('https://www.instagram.com/p/AbCdEf/').mediaType, 'video');
});

test('accepts a simple public profile URL', () => {
  assert.equal(parseInstagramProfileUrl('https://www.instagram.com/example.creator/').username, 'example.creator');
});

test('rejects a forged hostname, HTTP, credentials, and non-Instagram domains', () => {
  for (const url of [
    'https://instagram.com.evil.test/reel/ABC/',
    'http://instagram.com/reel/ABC/',
    'https://attacker@www.instagram.com/reel/ABC/',
    'https://example.com/reel/ABC/',
  ]) assert.throws(() => parseInstagramMediaUrl(url));
});

test('rejects unsupported paths and private-story routes', () => {
  for (const url of [
    'https://www.instagram.com/stories/person/123/',
    'https://www.instagram.com/explore/tags/cats/',
    'https://www.instagram.com/accounts/login/',
  ]) assert.throws(() => parseInstagramMediaUrl(url));
});

test('rejects profile URL for reserved Instagram routes', () => {
  assert.throws(() => parseInstagramProfileUrl('https://www.instagram.com/accounts/'));
});
