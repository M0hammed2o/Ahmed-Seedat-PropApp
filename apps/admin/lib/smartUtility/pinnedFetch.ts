import 'server-only';
import http from 'node:http';
import https from 'node:https';
import type { LookupAddress } from 'node:dns';
import { isPrivateAddress } from './providers';

// SSRF guard, part 3 (TD-66): the connection is made to the SAME address that passed the public-address check.
// A plain fetch() resolves the hostname again when it connects, so a DNS-rebinding host could answer "public" to the
// check and "10.0.0.5" to the connection. Here the socket's own `lookup` hook does the resolution, rejects any
// private/reserved answer, and hands the socket exactly the addresses it validated. No redirects are followed.

export type Resolver = (hostname: string) => Promise<string[]>;

async function systemResolve(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  return (await lookup(hostname, { all: true })).map((r) => r.address);
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A `lookup` for net/tls sockets that only ever yields public addresses (or fails). Exported for tests. */
export function guardedLookup(resolve: Resolver = systemResolve, allowPrivate = false) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    resolve(hostname)
      .then((addresses) => {
        if (addresses.length === 0) throw Object.assign(new Error(`${hostname} did not resolve`), { code: 'ENOTFOUND' });
        if (!allowPrivate && addresses.some(isPrivateAddress)) {
          throw Object.assign(new Error('The server address resolves to a private or reserved network address.'), { code: 'EPRIVATE' });
        }
        const entries: LookupAddress[] = addresses.map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 }));
        if (typeof options === 'object' && options?.all) callback(null, entries);
        else callback(null, entries[0]!.address, entries[0]!.family);
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, '', 0));
  };
}

function isLocalHost(host: string) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * fetch-compatible client for customer-supplied servers. HTTPS only (plain HTTP to localhost outside production for
 * local development), pinned public addresses, no redirects, body capped at 10 MB.
 */
export function pinnedFetch(opts: { resolve?: Resolver; allowLocal?: boolean; maxBytes?: number } = {}): typeof fetch {
  const allowLocal = opts.allowLocal ?? process.env.NODE_ENV !== 'production';
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
    const local = isLocalHost(url.hostname);
    if (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) {
      throw new Error('Only https server addresses are allowed.');
    }
    if (local && !allowLocal) throw new Error('Local addresses are not allowed.');
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = typeof init.body === 'string' ? init.body : init.body == null ? undefined : String(init.body);
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
    const client = url.protocol === 'https:' ? https : http;
    return await new Promise<Response>((resolvePromise, reject) => {
      const req = client.request(
        url,
        {
          method: init.method ?? 'GET',
          headers,
          lookup: guardedLookup(opts.resolve, allowLocal && local) as never,
          signal: init.signal ?? undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              req.destroy(new Error('Response too large.'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') h.set(k, v);
            // Redirects are returned as-is (status 3xx) and never followed: callers treat them as failures.
            resolvePromise(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502, headers: h }));
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  };
  return impl as typeof fetch;
}
