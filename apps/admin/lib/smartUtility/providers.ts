// Universal meter integration engine (docs/SMART_UTILITIES_PROGRESS.md §3). One descriptor per
// provider; the core (storeReadings, consumption, alerts, billing, reports) never branches on the
// provider. Push providers parse inbound payloads; poll providers verify a connection and fetch
// readings with server-held (encrypted) credentials.
//
// Formats come from vendor documentation (sources in docs/SA_SMART_METER_CATALOGUE.md) and are
// pinned by tests. None has been exercised against a live server or physical device yet.

import {
  AdapterError,
  decodeEm300Di,
  parseGenericJson,
  parseMilesight,
  parseShelly,
  type NormalisedReading,
} from './adapters';

export type ProviderId =
  | 'milesight_lorawan'
  | 'shelly_gen2'
  | 'generic_json'
  | 'simulator'
  | 'chirpstack_v4'
  | 'tts_v3'
  | 'thingsboard';

export type VerificationLevel =
  /** Proplyst's own contract; proven end-to-end in tests. */
  | 'verified'
  /** Implemented against published documentation; needs a real device/server to confirm. */
  | 'needs_hardware_testing'
  /** Synthetic data only. */
  | 'simulated';

export interface PollContext {
  config: Record<string, unknown>;
  credentials: Record<string, string>;
  fetchImpl: typeof fetch;
  /** DNS resolver (all addresses for a hostname); injectable for tests. Defaults to the system resolver. */
  lookupImpl?: (hostname: string) => Promise<string[]>;
}

export interface PollDevice {
  deviceId: string;
  channel: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  mode: 'push' | 'poll';
  verification: VerificationLevel;
  docsUrl: string;
  deviceIdLabel: string;
  channelHelp: string;
  credentialFields: { key: string; label: string; secret: boolean; optional?: boolean }[];
  configFields: { key: string; label: string; placeholder?: string }[];
  /** Push: payload → readings. `query` carries URL query params (ChirpStack's ?event=up). */
  parsePush?: (body: unknown, receivedAt: Date, query: URLSearchParams) => NormalisedReading[];
  verifyConnection?: (ctx: PollContext) => Promise<{ ok: boolean; message: string }>;
  poll?: (ctx: PollContext, devices: PollDevice[], since: Date, until: Date) => Promise<NormalisedReading[]>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Readings from a decoded LoRaWAN payload object: every non-negative numeric top-level field becomes
 * a channel named after the field (e.g. "pulse", "water_counter", "total_kwh"). The meter's
 * external_channel selects which one is its register; unbound channels are ignored by storeReadings.
 */
function readingsFromDecoded(
  deviceId: string,
  decoded: Record<string, unknown>,
  at: Date,
  eventBase: string,
): NormalisedReading[] {
  const out: NormalisedReading[] = [];
  for (const [key, val] of Object.entries(decoded)) {
    const n = finite(val);
    if (n === null || typeof val === 'boolean') continue;
    out.push({ externalDeviceId: deviceId, channel: key, readAt: at, rawValue: n, eventId: `${eventBase}:${key}` });
  }
  return out;
}

function parseTime(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ChirpStack v4 HTTP integration (JSON encoding). Event type is the `event` query parameter; only
 * "up" carries readings — other events are acknowledged and ignored. Fields per
 * api/proto/integration/integration.proto UplinkEvent: deduplicationId, time, deviceInfo.devEui,
 * fCnt, fPort, data (base64), object (only when a device-profile codec is configured).
 */
export function parseChirpStack(body: unknown, receivedAt: Date, query: URLSearchParams): NormalisedReading[] {
  const event = query.get('event');
  if (event && event !== 'up') return [];
  if (!isRecord(body)) throw new AdapterError('ChirpStack event must be a JSON object');
  const info = isRecord(body.deviceInfo) ? body.deviceInfo : null;
  const devEui = info?.devEui;
  if (typeof devEui !== 'string' || !/^[0-9a-fA-F]{16}$/.test(devEui)) {
    throw new AdapterError('ChirpStack uplink is missing deviceInfo.devEui');
  }
  const deviceId = devEui.toUpperCase();
  const at = parseTime(body.time) ?? receivedAt;
  const base =
    typeof body.deduplicationId === 'string' ? `cs:${body.deduplicationId}` : `cs:${deviceId}:${body.fCnt ?? ''}:${at.toISOString()}`;
  if (isRecord(body.object)) {
    const out = readingsFromDecoded(deviceId, body.object, at, base);
    if (out.length > 0) return out;
  }
  if (typeof body.data === 'string' && body.data.length > 0) {
    // No codec: EM300-DI frames are recognised by their published channel layout.
    const decoded = decodeEm300Di(Uint8Array.from(Buffer.from(body.data, 'base64')));
    if (decoded.pulse !== undefined) {
      return [{ externalDeviceId: deviceId, channel: 'pulse', readAt: at, rawValue: decoded.pulse, eventId: `${base}:pulse` }];
    }
  }
  throw new AdapterError(`ChirpStack uplink from ${deviceId} has no decoded numeric fields (configure a device-profile codec)`);
}

/**
 * The Things Stack v3 webhook uplink (Data Formats page): end_device_ids.dev_eui, received_at,
 * uplink_message.{f_cnt, frm_payload, decoded_payload, received_at}. Non-uplink messages (join
 * accepts, downlink events) are acknowledged and ignored.
 */
export function parseTts(body: unknown, receivedAt: Date): NormalisedReading[] {
  if (!isRecord(body)) throw new AdapterError('The Things Stack message must be a JSON object');
  const up = isRecord(body.uplink_message) ? body.uplink_message : null;
  if (!up) return [];
  const ids = isRecord(body.end_device_ids) ? body.end_device_ids : null;
  const devEui = ids?.dev_eui;
  if (typeof devEui !== 'string' || !/^[0-9a-fA-F]{16}$/.test(devEui)) {
    throw new AdapterError('The Things Stack uplink is missing end_device_ids.dev_eui');
  }
  const deviceId = devEui.toUpperCase();
  const at = parseTime(up.received_at) ?? parseTime(body.received_at) ?? receivedAt;
  const base = `tts:${deviceId}:${up.f_cnt ?? ''}:${at.toISOString()}`;
  if (isRecord(up.decoded_payload)) {
    const out = readingsFromDecoded(deviceId, up.decoded_payload, at, base);
    if (out.length > 0) return out;
  }
  if (typeof up.frm_payload === 'string' && up.frm_payload.length > 0) {
    const decoded = decodeEm300Di(Uint8Array.from(Buffer.from(up.frm_payload, 'base64')));
    if (decoded.pulse !== undefined) {
      return [{ externalDeviceId: deviceId, channel: 'pulse', readAt: at, rawValue: decoded.pulse, eventId: `${base}:pulse` }];
    }
  }
  throw new AdapterError(`The Things Stack uplink from ${deviceId} has no decoded numeric fields (configure a payload formatter)`);
}

// ---------------------------------------------------------------- ThingsBoard (poll)

/** SSRF guard for customer-supplied base URLs: https only, no IP literals in private ranges, no localhost. */
export function validateBaseUrl(raw: unknown, allowInsecureLocal = false): URL {
  if (typeof raw !== 'string') throw new AdapterError('A server address is required.');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new AdapterError('The server address is not a valid URL.');
  }
  const host = url.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  if (isLocal && allowInsecureLocal) return url;
  if (url.protocol !== 'https:') throw new AdapterError('The server address must use https.');
  if (isLocal) throw new AdapterError('Local addresses are not allowed.');
  if (isPrivateAddress(host)) throw new AdapterError('Private or reserved IP addresses are not allowed.');
  if (host.startsWith('[') || host.includes(':')) throw new AdapterError('IPv6 literal addresses are not allowed.');
  if (url.username || url.password) throw new AdapterError('Put credentials in the credential fields, not the address.');
  return url;
}

/** True for loopback, private, link-local, CGNAT, benchmarking, multicast/reserved IPv4 and the IPv6 equivalents. */
export function isPrivateAddress(address: string): boolean {
  const a6 = address.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a6);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped ? mapped[1]! : a6);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 192 && b === 0) ||
      a >= 224
    );
  }
  if (a6.includes(':')) {
    return a6 === '::' || a6 === '::1' || /^f[cd]/.test(a6) || /^fe[89ab]/.test(a6) || a6.startsWith('ff') || a6.startsWith('64:ff9b:');
  }
  return false;
}

async function systemLookup(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  return (await lookup(hostname, { all: true })).map((r) => r.address);
}

/**
 * SSRF guard, part 2 (TD-58): the hostname must resolve, and EVERY address it resolves to must be public. Checked
 * before each request. Residual risk: DNS rebinding between this check and the connection (documented; pinning the
 * address needs a custom agent or an egress proxy).
 */
export async function assertResolvesPublic(base: URL, lookupImpl?: (hostname: string) => Promise<string[]>): Promise<void> {
  const host = base.hostname.replace(/^\[|\]$/g, '');
  if (allowLocal() && (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1')) return;
  let addresses: string[];
  try {
    addresses = await (lookupImpl ?? systemLookup)(host);
  } catch {
    throw new AdapterError(`The server address ${host} could not be resolved.`);
  }
  if (addresses.length === 0) throw new AdapterError(`The server address ${host} could not be resolved.`);
  if (addresses.some(isPrivateAddress)) throw new AdapterError('The server address resolves to a private or reserved network address.');
}

async function tbAuthHeader(ctx: PollContext, base: URL): Promise<string> {
  if (ctx.credentials.apiKey) return `ApiKey ${ctx.credentials.apiKey}`;
  if (ctx.credentials.username && ctx.credentials.password) {
    // JWT login is documented as deprecated (API keys since 4.3) but still supported.
    const res = await ctx.fetchImpl(new URL('/api/auth/login', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ctx.credentials.username, password: ctx.credentials.password }),
      redirect: 'error', // never follow a redirect to an unvalidated host
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new AdapterError(`ThingsBoard login failed (HTTP ${res.status})`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new AdapterError('ThingsBoard login returned no token');
    return `Bearer ${body.token}`;
  }
  throw new AdapterError('ThingsBoard needs an API key, or a username and password.');
}

function allowLocal(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export const thingsboardVerify = async (ctx: PollContext) => {
  try {
    const base = validateBaseUrl(ctx.config.baseUrl, allowLocal());
    await assertResolvesPublic(base, ctx.lookupImpl);
    const auth = await tbAuthHeader(ctx, base);
    const res = await ctx.fetchImpl(new URL('/api/auth/user', base), {
      headers: { 'X-Authorization': auth },
      redirect: 'error', // never follow a redirect to an unvalidated host
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'ThingsBoard rejected the credentials.' };
    if (!res.ok) return { ok: false, message: `ThingsBoard responded HTTP ${res.status}.` };
    return { ok: true, message: 'Connected to ThingsBoard.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed.' };
  }
};

/**
 * GET /api/plugins/telemetry/DEVICE/{deviceId}/values/timeseries?keys=…&startTs&endTs&limit&orderBy
 * → {"key":[{"ts":ms,"value":"string"}]}. One request per device, all bound keys at once.
 */
const TB_PAGE_LIMIT = 1000;
const TB_MAX_PAGES = 50;

export const thingsboardPoll = async (ctx: PollContext, devices: PollDevice[], since: Date, until: Date) => {
  const base = validateBaseUrl(ctx.config.baseUrl, allowLocal());
  await assertResolvesPublic(base, ctx.lookupImpl);
  const auth = await tbAuthHeader(ctx, base);
  const byDevice = new Map<string, Set<string>>();
  for (const d of devices) {
    if (!d.channel) continue;
    const set = byDevice.get(d.deviceId) ?? new Set<string>();
    set.add(d.channel);
    byDevice.set(d.deviceId, set);
  }
  const out: NormalisedReading[] = [];
  for (const [deviceId, keys] of byDevice) {
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw new AdapterError(`ThingsBoard device id ${deviceId} is not a UUID`);
    // Page by timestamp: ThingsBoard returns at most `limit` points per key per request. Never skip a page — a
    // backfill longer than one page used to drop the rest while the sync cursor still moved forward.
    let startTs = since.getTime();
    for (let page = 0; ; page += 1) {
      if (page >= TB_MAX_PAGES) {
        throw new AdapterError(`ThingsBoard returned more than ${TB_MAX_PAGES * TB_PAGE_LIMIT} points for ${deviceId}; sync stopped so no data is skipped. Shorten the backfill window.`);
      }
      const url = new URL(`/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries`, base);
      url.searchParams.set('keys', [...keys].join(','));
      url.searchParams.set('startTs', String(startTs));
      url.searchParams.set('endTs', String(until.getTime()));
      url.searchParams.set('limit', String(TB_PAGE_LIMIT));
      url.searchParams.set('orderBy', 'ASC');
      const res = await ctx.fetchImpl(url, { headers: { 'X-Authorization': auth }, redirect: 'error', // never follow a redirect to an unvalidated host
        signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new AdapterError(`ThingsBoard telemetry request failed for ${deviceId} (HTTP ${res.status})`);
      const body = (await res.json()) as Record<string, { ts: number; value: string | number }[]>;
      // Next page starts after the EARLIEST last point among keys that filled their page (a key that did not fill
      // its page returned everything; re-fetching some of it is harmless — inserts are idempotent).
      let nextStart: number | null = null;
      for (const key of keys) {
        const pts = body[key] ?? [];
        if (pts.length >= TB_PAGE_LIMIT) {
          const last = pts[pts.length - 1]?.ts;
          if (typeof last === 'number' && (nextStart === null || last < nextStart)) nextStart = last;
        }
        for (const p of pts) {
          const v = finite(p.value);
          if (v === null || typeof p.ts !== 'number') continue;
          out.push({ externalDeviceId: deviceId, channel: key, readAt: new Date(p.ts), rawValue: v, eventId: `tb:${deviceId}:${key}:${p.ts}` });
        }
      }
      if (nextStart === null) break;
      if (nextStart < startTs) throw new AdapterError(`ThingsBoard returned out-of-order points for ${deviceId}; sync stopped so no data is skipped.`);
      // Same-millisecond points straddling a page boundary are re-requested from nextStart (not +1) so none are lost.
      if (nextStart === startTs) throw new AdapterError(`More than ${TB_PAGE_LIMIT} points share one timestamp for ${deviceId}; cannot page safely.`);
      startTs = nextStart;
    }
  }
  return out;
};

// ---------------------------------------------------------------- registry

const LORA_CHANNEL_HELP =
  'The decoded field that holds the cumulative register, e.g. "pulse" (Milesight EM300-DI codec) or your codec\'s counter field.';

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  milesight_lorawan: {
    id: 'milesight_lorawan',
    label: 'Milesight gateway (built-in network server, HTTP)',
    mode: 'push',
    verification: 'needs_hardware_testing',
    docsUrl: 'https://github.com/Milesight-IoT/SensorDecoders',
    deviceIdLabel: 'DevEUI (16 hex characters)',
    channelHelp: 'Leave empty for the EM300-DI pulse counter.',
    credentialFields: [],
    configFields: [],
    parsePush: (b, at) => parseMilesight(b, at),
  },
  chirpstack_v4: {
    id: 'chirpstack_v4',
    label: 'ChirpStack v4 (HTTP integration)',
    mode: 'push',
    verification: 'needs_hardware_testing',
    docsUrl: 'https://www.chirpstack.io/docs/chirpstack/integrations/http.html',
    deviceIdLabel: 'DevEUI (16 hex characters)',
    channelHelp: LORA_CHANNEL_HELP,
    credentialFields: [],
    configFields: [],
    parsePush: parseChirpStack,
  },
  tts_v3: {
    id: 'tts_v3',
    label: 'The Things Stack (webhook)',
    mode: 'push',
    verification: 'needs_hardware_testing',
    docsUrl: 'https://www.thethingsindustries.com/docs/integrations/data-formats/',
    deviceIdLabel: 'DevEUI (16 hex characters)',
    channelHelp: LORA_CHANNEL_HELP,
    credentialFields: [],
    configFields: [],
    parsePush: (b, at) => parseTts(b, at),
  },
  shelly_gen2: {
    id: 'shelly_gen2',
    label: 'Shelly Gen2+ devices (Wi-Fi, HTTP push script)',
    mode: 'push',
    verification: 'needs_hardware_testing',
    docsUrl: 'https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/EMData',
    deviceIdLabel: 'Shelly device id (e.g. shellypro3em-a0b1c2d3e4f5)',
    channelHelp: 'total / a / b / c (Pro 3EM), em1:0 / em1:1 (Pro EM-50, EM Gen3), input:0 (Plus Uni pulses).',
    credentialFields: [],
    configFields: [],
    parsePush: (b, at) => parseShelly(b, at),
  },
  generic_json: {
    id: 'generic_json',
    // 'verified' covers the Proplyst JSON contract only (automated tests). Modbus gateways that post it are
    // documented but untested with real hardware — see meterCatalogue.ts entries marked needs_hardware_testing.
    label: 'Proplyst JSON (any device or gateway)',
    mode: 'push',
    verification: 'verified',
    docsUrl: '/docs/SMART_UTILITY_ARCHITECTURE.md#123-modbus-gateways-teltonika-trb246-waveshare-esphome--proplyst',
    deviceIdLabel: 'Device id as sent by the gateway',
    channelHelp: 'Channel as sent by the gateway (e.g. kwh).',
    credentialFields: [],
    configFields: [],
    parsePush: (b, at) => parseGenericJson(b, at),
  },
  simulator: {
    id: 'simulator',
    label: 'Simulator (testing only)',
    mode: 'push',
    verification: 'simulated',
    docsUrl: '',
    deviceIdLabel: 'Any id used by the simulator script',
    channelHelp: 'Leave empty.',
    credentialFields: [],
    configFields: [],
    parsePush: (b, at) => parseGenericJson(b, at),
  },
  thingsboard: {
    id: 'thingsboard',
    label: 'ThingsBoard (REST API, polled)',
    mode: 'poll',
    verification: 'needs_hardware_testing',
    docsUrl: 'https://thingsboard.io/docs/reference/rest-api/',
    deviceIdLabel: 'ThingsBoard device id (UUID)',
    channelHelp: 'The telemetry key holding the cumulative register (e.g. "energy" or "pulseCount").',
    credentialFields: [
      { key: 'apiKey', label: 'API key (recommended)', secret: true, optional: true },
      { key: 'username', label: 'Username (legacy login)', secret: false, optional: true },
      { key: 'password', label: 'Password (legacy login)', secret: true, optional: true },
    ],
    configFields: [{ key: 'baseUrl', label: 'Server address', placeholder: 'https://thingsboard.example.com' }],
    verifyConnection: thingsboardVerify,
    poll: thingsboardPoll,
  },
};

export function getProvider(id: string): ProviderDescriptor | null {
  return (PROVIDERS as Record<string, ProviderDescriptor>)[id] ?? null;
}

export function parsePush(
  provider: string,
  body: unknown,
  receivedAt: Date,
  query: URLSearchParams = new URLSearchParams(),
): NormalisedReading[] {
  const p = getProvider(provider);
  if (!p?.parsePush) throw new AdapterError(`${provider} does not accept pushed readings`);
  return p.parsePush(body, receivedAt, query);
}
