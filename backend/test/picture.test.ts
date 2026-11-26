// The picture pass-through: only public addresses, only raster images, redirects checked again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passPicture } from '../src/picture.ts';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test('picture: a public image is passed on with its type, and the response cannot run anything', async () => {
  const res = await passPicture('https://logos.example.org/a.png', async () => new Response(png, { headers: { 'content-type': 'image/png' } }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('content-security-policy'), "default-src 'none'");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), png);
});

test('picture: addresses on this computer or its network, SVG and pages are refused', async () => {
  let fetched = 0;
  const any = async () => {
    fetched++;
    return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
  };
  for (const bad of ['http://localhost:8787/api/students/me', 'http://192.168.1.1/x.png', 'http://169.254.169.254/latest', 'file:///etc/passwd', undefined]) assert.equal((await passPicture(bad, any)).status, 404, String(bad));
  assert.equal(fetched, 0, 'nothing local was fetched');
  assert.equal((await passPicture('https://example.org/x.svg', any)).status, 404, 'SVG');
  assert.equal((await passPicture('https://example.org/', async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }))).status, 404, 'a page');
});

test('picture: a redirect to a local address is not followed', async () => {
  const seen: string[] = [];
  const res = await passPicture('https://example.org/logo.png', async (u) => {
    seen.push(String(u));
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8787/api/students/me' } });
  });
  assert.equal(res.status, 404);
  assert.deepEqual(seen, ['https://example.org/logo.png']);
});
