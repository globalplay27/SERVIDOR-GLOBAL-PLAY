export async function getState(env, namespace, itemKey, clientId = "") {
  const row = await env.DB.prepare(
    `SELECT value_json, updated_at FROM nexus_state
     WHERE namespace = ?1 AND item_key = ?2 AND client_id = ?3
     LIMIT 1`
  ).bind(String(namespace), String(itemKey), String(clientId)).first();
  if (!row) return null;
  let value = null;
  try { value = JSON.parse(String(row.value_json || "null")); } catch { value = null; }
  return { value, updatedAt: row.updated_at || null };
}

export async function putState(env, namespace, itemKey, clientId, value) {
  const payload = JSON.stringify(value ?? null);
  await env.DB.prepare(
    `INSERT INTO nexus_state(namespace, item_key, client_id, value_json, updated_at)
     VALUES(?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
     ON CONFLICT(namespace, item_key, client_id)
     DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
  ).bind(String(namespace), String(itemKey), String(clientId || ""), payload).run();
  return getState(env, namespace, itemKey, clientId || "");
}

export async function deleteState(env, namespace, itemKey, clientId = "") {
  const result = await env.DB.prepare(
    `DELETE FROM nexus_state
     WHERE namespace = ?1 AND item_key = ?2 AND client_id = ?3`
  ).bind(String(namespace), String(itemKey), String(clientId)).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function putMedia(env, key, body, httpMetadata = {}) {
  if (!env.MEDIA) throw new Error("r2_not_bound");
  await env.MEDIA.put(String(key), body, { httpMetadata });
  return { key: String(key) };
}

export async function getMedia(env, key) {
  if (!env.MEDIA) throw new Error("r2_not_bound");
  return env.MEDIA.get(String(key));
}

export async function deleteMedia(env, key) {
  if (!env.MEDIA) throw new Error("r2_not_bound");
  await env.MEDIA.delete(String(key));
  return true;
}
