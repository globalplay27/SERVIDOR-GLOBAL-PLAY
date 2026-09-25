INSERT OR IGNORE INTO clients(id, name, niche, instagram, status, config_json)
VALUES(
  'ragnar-one',
  'Ragnar One',
  'Streaming',
  '@ragnarplay1',
  'online',
  '{"runtime":"cloudflare","openaiKeySource":"ragnar-exclusive","agentName":"NEXUS","agentEngine":"NEXUS","odin":true,"setupMode":"ready"}'
);

INSERT OR IGNORE INTO clients(id, name, niche, instagram, status, config_json)
VALUES(
  'globalplay-streaming',
  'Global Play',
  'Streaming',
  '@globalplay_streaming',
  'online',
  '{"runtime":"cloudflare","openaiKeySource":"shared","agentName":"NEXUS","agentEngine":"NEXUS","odin":true,"setupMode":"ready","ownerAccount":true}'
);
