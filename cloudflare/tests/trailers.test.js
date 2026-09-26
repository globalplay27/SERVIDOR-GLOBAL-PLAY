import test from 'node:test';
import assert from 'node:assert/strict';
import { searchTrailers } from '../src/trailers.js';

const db = { prepare: () => ({ bind() { return this; }, async run() {} }) };
const env = { DB: db, OPENAI_API_KEY_SHARED: 'test-key' };
async function withFetch(fn, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('complete catalog response preserves works without inventing a trailer', async () => {
  await withFetch(async (url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_output_tokens, 4000);
    return Response.json({ status: 'completed', output: [{ content: [{ text: JSON.stringify({ results: [{ title: 'Michael', year: '2026', overview: 'Filme biográfico.', official: false }] }) }] }] });
  }, async () => {
    const result = await searchTrailers(env, 'testador', 'MICHAEL JACKSON');
    assert.equal(result.results[0].title, 'Michael');
    assert.equal(result.results[0].trailerUrl, '');
    assert.equal(result.configured, true);
  });
});

test('truncated or malformed responses are errors, not cacheable empty successes', async () => {
  for (const [response, code] of [
    [{ status: 'incomplete', output_text: '{"results":[' }, 'trailer_response_incomplete'],
    [{ status: 'completed', output_text: 'Invalid JSON' }, 'trailer_response_invalid'],
    [{ status: 'completed', output_text: '{}' }, 'trailer_response_invalid']
  ]) {
    await withFetch(async () => Response.json(response), async () => {
      await assert.rejects(searchTrailers(env, 'testador', 'Michael'), { message: code });
    });
  }
});

test('missing credentials produce an actionable configuration error', async () => {
  await assert.rejects(searchTrailers({ DB: db }, 'testador', 'Michael'), { message: 'trailer_catalog_not_configured' });
});

test('valid empty TMDB catalog does not invoke a paid fallback', async () => {
  let calls = 0;
  await withFetch(async url => {
    assert.match(String(url), /api.themoviedb.org/);
    calls++;
    return Response.json({ results: [] });
  }, async () => {
    const result = await searchTrailers({ ...env, TMDB_API_TOKEN: 'test-token' }, 'testador', 'Unknown title');
    assert.equal(result.configured, true);
    assert.deepEqual(result.results, []);
    assert.equal(calls, 1);
  });
});
