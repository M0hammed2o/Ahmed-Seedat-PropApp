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
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 192 && b === 0) ||
      a >= 224
    ) {
      throw new AdapterError('Private or reserved IP addresses are not allowed.');
    }
  }
  if (host.startsWith('[') || host.includes(':')) throw new AdapterError('IPv6 literal addresses are not allowed.');
  if (url.username || url.password) throw new AdapterError('Put credentials in the credential fields, not the address.');
  return url;
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
export const thingsboardPoll = async (ctx: PollContext, devices: PollDevice[], since: Date, until: Date) => {
  const base = validateBaseUrl(ctx.config.baseUrl, allowLocal());
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
    const url = new URL(`/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries`, base);
    url.searchParams.set('keys', [...keys].join(','));
    url.searchParams.set('startTs', String(since.getTime()));
    url.searchParams.set('endTs', String(until.getTime()));
    url.searchParams.set('limit', '1000');
    url.searchParams.set('orderBy', 'ASC');
    const res = await ctx.fetchImpl(url, { headers: { 'X-Authorization': auth }, redirect: 'error', // never follow a redirect to an unvalidated host
      signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new AdapterError(`ThingsBoard telemetry request failed for ${deviceId} (HTTP ${res.status})`);
    const body = (await res.json()) as Record<string, { ts: number; value: string | number }[]>;
    for (const key of keys) {
      for (const p of body[key] ?? []) {
        const v = finite(p.value);
        if (v === null || typeof p.ts !== 'number') continue;
        out.push({ externalDeviceId: deviceId, channel: key, readAt: new Date(p.ts), rawValue: v, eventId: `tb:${deviceId}:${key}:${p.ts}` });
      }
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
    label: 'Modbus gateway / any device (Proplyst JSON)',
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
