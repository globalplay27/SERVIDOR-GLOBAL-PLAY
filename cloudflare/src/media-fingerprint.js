// Compare image bytes, not the public URL: the same Instagram image can be
// copied to a new R2 key and otherwise evade the URL-based repeat gate.
export async function mediaFingerprint(env, imageUrl, fetchMedia = fetch) {
  try {
    const url = new URL(String(imageUrl || ''));
    if (url.protocol !== 'https:') return '';
    const origin = String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const own = origin && url.origin === new URL(origin).origin;
    let response;
    if (own && url.pathname.startsWith('/media/') && env.MEDIA) {
      const object = await env.MEDIA.get(decodeURIComponent(url.pathname.slice('/media/'.length)));
      if (!object || Number(object.size || 0) > 5_000_000) return '';
      response = new Response(object.body);
    } else if (own && url.pathname.startsWith('/assets/') && env.ASSETS) {
      response = await env.ASSETS.fetch(new Request(url.toString(), { signal: AbortSignal.timeout(8000) }));
    } else {
      response = await fetchMedia(url.toString(), { signal: AbortSignal.timeout(8000) });
    }
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 5_000_000) return '';
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 5_000_000) return '';
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}
