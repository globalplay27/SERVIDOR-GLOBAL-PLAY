import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeUrl, searchCatalog, catalogMetadata, portugueseTrailerScore } from '../src/video-catalog.js';

test('Every title requires a verified official trailer with Portuguese evidence; English and fan uploads are rejected', () => {
  const valid = { title: 'Reacher — Trailer oficial dublado', channel: 'Prime Video Brasil', channelVerified: true };
  assert.ok(portugueseTrailerScore(valid) >= 0);
  assert.ok(portugueseTrailerScore({...valid,channelVerified:false,channelId:'UCuNjvqjTzw9LcD9PVpTVWRA'}) >= 0);
  assert.equal(portugueseTrailerScore({...valid,channelVerified:false,channelId:'fake'}) ,-1);
  for (const patch of [
    { title: 'Reacher — Official trailer English' },
    { title: 'Reacher — Trailer legendado' },
    { channel: 'Fan trailers Brasil' },
    { channelVerified: false },
    { title: 'Reacher entrevista dublada' },
    { title: 'Michael Official Trailer', channel: 'Universal Pictures' }
  ]) assert.equal(portugueseTrailerScore({ ...valid, ...patch }), -1);
});

test('YouTube imports accept canonical public video URLs and reject foreign hosts and playlists', () => {
  for (const url of ['https://youtu.be/0123456789_', 'https://www.youtube.com/watch?v=0123456789_&list=ignore', 'https://youtube.com/shorts/0123456789_']) assert.equal(youtubeUrl(url), 'https://www.youtube.com/watch?v=0123456789_');
  for (const url of ['https://youtube.com.evil.test/watch?v=0123456789_', 'http://youtube.com/watch?v=0123456789_', 'https://youtube.com/playlist?list=x', 'https://127.0.0.1/source.mp4']) assert.equal(youtubeUrl(url), '');
});

test('Series metadata selects the requested catalogue ID and never uses another title as fallback', async () => {
  const previous=global.fetch;
  global.fetch=async url => {
    const payload=String(url).includes('search/shows') ? [{show:{id:1,name:'Reacher',premiered:'2022-02-04',summary:'<p>Jack Reacher investigates.</p>',image:{original:'https://static.tvmaze.com/poster.jpg'}}}]
      : String(url).endsWith('/cast') ? [{person:{name:'Alan Ritchson',image:{original:'https://static.tvmaze.com/alan.jpg'}}}]
      : String(url).includes('?page=0') ? [{id:2,name:'Other thriller',genres:['Action'],rating:{average:8},image:{original:'https://static.tvmaze.com/related.jpg'}}]
      : {id:1,name:'Reacher',genres:['Action'],averageRuntime:60,rating:{average:8.1},url:'https://www.tvmaze.com/shows/1/reacher'};
    return new Response(JSON.stringify(payload));
  };
  try {
    const matches=await searchCatalog('Reacher','series'); assert.equal(matches[0].overview,'Jack Reacher investigates.');
    const metadata=await catalogMetadata('Reacher','series','tvmaze:1');
    assert.equal(metadata.cast[0].name,'Alan Ritchson'); assert.equal(metadata.reviews[0].source,'TVmaze'); assert.equal(metadata.related[0].title,'Other thriller');
    await assert.rejects(catalogMetadata('Reacher','series','tvmaze:999'), /catalog_title_not_found/);
  } finally {global.fetch=previous;}
});
