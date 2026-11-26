// A card's picture passed on through the backend, so the dashboard can read its pixels (the
// colour round a logo's edge) when the picture's own server does not allow pages to. Only public
// web addresses, followed through at most three redirects that are each checked again, only
// raster images (no SVG, which could carry script), at most 8 MB.
import { safeUrl } from './agents/images.ts';

const TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']);
const MAX_BYTES = 8_000_000;

export async function passPicture(raw: string | undefined, fetcher: typeof fetch = fetch): Promise<Response> {
  let url = safeUrl(raw);
  for (let hop = 0; url && hop < 4; hop++) {
    const res = await fetcher(url, { headers: { accept: 'image/*', 'user-agent': 'Mozilla/5.0 BearRok' }, redirect: 'manual', signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res) return new Response('not found', { status: 404 });
    if (res.status >= 300 && res.status < 400) {
      url = safeUrl(res.headers.get('location'), url.href);
      continue;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const length = Number(res.headers.get('content-length') ?? 0);
    if (!res.ok || !TYPES.has(type) || length > MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      return new Response('not a picture', { status: 404 });
    }
    const bytes = await res.arrayBuffer().catch(() => null);
    if (!bytes || bytes.byteLength > MAX_BYTES) return new Response('not a picture', { status: 404 });
    return new Response(bytes, {
      headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" },
    });
  }
  return new Response('not found', { status: 404 });
}
