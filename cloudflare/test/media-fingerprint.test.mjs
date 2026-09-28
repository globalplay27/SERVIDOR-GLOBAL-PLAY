import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaFingerprint } from '../src/media-fingerprint.js';

test('identical artwork under different URLs has the same fingerprint', async () => {
  const bytes = new TextEncoder().encode('one original image');
  const fetchMedia = async () => new Response(bytes, { status: 200 });
  const env = { PUBLIC_BASE_URL: 'https://example.com' };
  const first = await mediaFingerprint(env, 'https://cdn.example.com/old.jpg', fetchMedia);
  const copy = await mediaFingerprint(env, 'https://cdn.example.com/new-r2-key.jpg', fetchMedia);
  assert.equal(first, copy);
  assert.equal(first.length, 64);
});

test('different art has a different fingerprint and missing media fails closed', async () => {
  const env = { PUBLIC_BASE_URL: 'https://example.com' };
  const first = await mediaFingerprint(env, 'https://cdn.example.com/one.jpg',
    async () => new Response('first image'));
  const second = await mediaFingerprint(env, 'https://cdn.example.com/two.jpg',
    async () => new Response('second image'));
  assert.notEqual(first, second);
  assert.equal(await mediaFingerprint(env, 'https://cdn.example.com/missing.jpg',
    async () => new Response('', { status: 404 })), '');
});
