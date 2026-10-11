import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { guardedLookup, pinnedFetch } = await import('../pinnedFetch');

// TD-66: the socket connects to the address that passed the public-address check (no second, rebindable lookup).

const run = (lookup: ReturnType<typeof guardedLookup>, options: { all?: boolean } | undefined) =>
  new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
    lookup('meters.example', options, (err, address, family) => resolve({ err, address, family })),
  );

describe('guarded lookup', () => {
  it('refuses a name that resolves to any private address (rebinding cannot slip through at connect time)', async () => {
    const r = await run(guardedLookup(async () => ['93.184.216.34', '10.0.0.5']), undefined);
    expect(r.err?.message).toMatch(/private or reserved/);
  });
  it('yields only the validated public addresses, in both lookup calling conventions', async () => {
    expect(await run(guardedLookup(async () => ['93.184.216.34']), undefined)).toMatchObject({ err: null, address: '93.184.216.34', family: 4 });
    expect((await run(guardedLookup(async () => ['93.184.216.34', '2001:4860:4860::8888']), { all: true })).address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
  });
  it('fails closed when the name does not resolve', async () => {
    expect((await run(guardedLookup(async () => []), undefined)).err?.message).toMatch(/did not resolve/);
  });
});

describe('pinned fetch', () => {
  it('refuses plain http and local addresses in production mode', async () => {
    const f = pinnedFetch({ allowLocal: false });
    await expect(f('http://meters.example/x')).rejects.toThrow(/Only https/);
    await expect(f('https://localhost/x')).rejects.toThrow(/Local addresses/);
  });
  it('performs a request and never follows a redirect (local dev server)', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, method: req.method }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const f = pinnedFetch({ allowLocal: true });
      const ok = await f(`http://127.0.0.1:${port}/x`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      expect(await ok.json()).toEqual({ ok: true, method: 'POST' });
      const redirect = await f(`http://127.0.0.1:${port}/redirect`);
      expect(redirect.status).toBe(302); // returned, not followed
    } finally {
      server.close();
    }
  });
});
