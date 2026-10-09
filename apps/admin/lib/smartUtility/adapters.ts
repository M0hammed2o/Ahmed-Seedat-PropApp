// Provider adapters for meter ingestion (docs/SMART_UTILITY_ARCHITECTURE.md §3). Pure: each adapter
// turns a provider's push payload into NormalisedReading[]; ingest.ts does auth, binding and storage.
// A new manufacturer = a new adapter + a test, never a schema change.

export type MeterProvider = 'milesight_lorawan' | 'shelly_gen2' | 'generic_json' | 'simulator';

export interface NormalisedReading {
  externalDeviceId: string;
  /** '' when the device has one register; otherwise e.g. 'total', 'a', 'em1:0', 'input:0'. */
  channel: string;
  readAt: Date;
  /** Raw cumulative register value (pulse count, Wh, kWh, L ... as the device reports it). */
  rawValue: number;
  /** Provider event identity for idempotency (frame counter, message id); null if none. */
  eventId: string | null;
}

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseTime(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // seconds vs milliseconds
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function finiteNonNegative(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------- Milesight (LoRaWAN)

/**
 * Decodes a Milesight EM300-DI uplink. Byte layout verified against Milesight's published decoder
 * (github.com/Milesight-IoT/SensorDecoders, em-series/em300-di/em300-di-decoder.js, read 2026-10-08):
 *   01 75 → battery uint8 · 03 67 → temperature int16LE/10 · 04 68 → humidity uint8/2
 *   05 00 → gpio uint8 · 05 C8 → pulse counter uint32LE
 *   20 CE → history record, 13 bytes: ts uint32LE, temp int16LE, hum uint8, mode uint8,
 *           gpio uint8, pulse uint32LE (pulse valid when mode = 2)
 * Unknown channels stop decoding (same behaviour as the vendor decoder).
 */
export function decodeEm300Di(bytes: Uint8Array): {
  pulse?: number;
  battery?: number;
  history: { timestamp: number; pulse: number }[];
} {
  const out: { pulse?: number; battery?: number; history: { timestamp: number; pulse: number }[] } = {
    history: [],
  };
  const u32 = (i: number) => (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16)) + bytes[i + 3]! * 0x1000000;
  for (let i = 0; i + 1 < bytes.length; ) {
    const id = bytes[i++]!;
    const type = bytes[i++]!;
    if (id === 0x01 && type === 0x75) {
      out.battery = bytes[i];
      i += 1;
    } else if (id === 0x03 && type === 0x67) {
      i += 2;
    } else if (id === 0x04 && type === 0x68) {
      i += 1;
    } else if (id === 0x05 && type === 0x00) {
      i += 1;
    } else if (id === 0x05 && type === 0xc8) {
      if (i + 4 > bytes.length) break;
      out.pulse = u32(i);
      i += 4;
    } else if (id === 0x20 && type === 0xce) {
      if (bytes.length - i < 13) break;
      const mode = bytes[i + 7]!;
      if (mode === 2) out.history.push({ timestamp: u32(i), pulse: u32(i + 9) });
      i += 13;
    } else {
      break;
    }
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

/**
 * Milesight gateway built-in network server → HTTP(S) integration uplink. Accepts the decoded
 * `object` when a codec is configured on the gateway, otherwise decodes the raw base64 `data`.
 * Device time: `time`, else rxInfo[0].time, else the receipt time supplied by the caller.
 */
export function parseMilesight(body: unknown, receivedAt: Date): NormalisedReading[] {
  const messages = Array.isArray(body) ? body : [body];
  const out: NormalisedReading[] = [];
  for (const msg of messages) {
    if (!isRecord(msg)) throw new AdapterError('Milesight uplink must be a JSON object');
    const devEui = (msg.devEUI ?? msg.devEui ?? msg.dev_eui) as unknown;
    if (typeof devEui !== 'string' || !/^[0-9a-fA-F]{16}$/.test(devEui)) {
      throw new AdapterError('Milesight uplink is missing a valid devEUI');
    }
    const rx = Array.isArray(msg.rxInfo) && isRecord(msg.rxInfo[0]) ? msg.rxInfo[0] : null;
    const at = parseTime(msg.time) ?? parseTime(rx?.time) ?? receivedAt;
    const fCnt = typeof msg.fCnt === 'number' ? msg.fCnt : null;
    const deviceId = devEui.toUpperCase();

    let pulse: number | null = null;
    let history: { timestamp: number; pulse: number }[] = [];
    if (isRecord(msg.object) && finiteNonNegative(msg.object.pulse) !== null) {
      pulse = finiteNonNegative(msg.object.pulse);
      if (Array.isArray(msg.object.history)) {
        history = msg.object.history
          .filter(isRecord)
          .filter((h) => finiteNonNegative(h.pulse) !== null && typeof h.timestamp === 'number')
          .map((h) => ({ timestamp: h.timestamp as number, pulse: h.pulse as number }));
      }
    } else if (typeof msg.data === 'string') {
      const decoded = decodeEm300Di(base64ToBytes(msg.data));
      pulse = decoded.pulse ?? null;
      history = decoded.history;
    }
    if (pulse === null && history.length === 0) {
      throw new AdapterError(`Milesight uplink from ${deviceId} carries no pulse counter`);
    }
    if (pulse !== null) {
      out.push({
        externalDeviceId: deviceId,
        channel: '',
        readAt: at,
        rawValue: pulse,
        eventId: fCnt !== null ? `${deviceId}:fcnt:${fCnt}:${at.toISOString()}` : null,
      });
    }
    for (const h of history) {
      out.push({
        externalDeviceId: deviceId,
        channel: '',
        readAt: new Date(h.timestamp * 1000),
        rawValue: h.pulse,
        eventId: `${deviceId}:hist:${h.timestamp}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Shelly Gen2+ (Wi-Fi)

/**
 * Shelly Gen2+ energy/pulse counters, posted to us by the on-device script in
 * docs/SMART_UTILITY_ARCHITECTURE.md (or a NotifyStatus-shaped frame). Field names follow Shelly's
 * public API: EMData.GetStatus `total_act` / `a_total_act_energy` … (Wh), EM1Data.GetStatus
 * `total_act_energy` (Wh), Input.GetStatus `counts.total` (pulses).
 */
export function parseShelly(body: unknown, receivedAt: Date): NormalisedReading[] {
  if (!isRecord(body)) throw new AdapterError('Shelly payload must be a JSON object');
  const src = body.src ?? body.device_id ?? body.id;
  if (typeof src !== 'string' || !/^[A-Za-z0-9-]{3,64}$/.test(src)) {
    throw new AdapterError('Shelly payload is missing the device id (src)');
  }
  const params = isRecord(body.params) ? body.params : body;
  const at = parseTime(params.ts) ?? parseTime(body.ts) ?? receivedAt;
  const out: NormalisedReading[] = [];
  const push = (channel: string, value: unknown) => {
    const v = finiteNonNegative(value);
    if (v === null) return;
    out.push({
      externalDeviceId: src,
      channel,
      readAt: at,
      rawValue: v,
      eventId: `${src}:${channel}:${Math.floor(at.getTime() / 1000)}`,
    });
  };
  for (const [key, val] of Object.entries(params)) {
    if (!isRecord(val)) continue;
    if (/^emdata:\d+$/.test(key)) {
      push('total', val.total_act);
      push('a', val.a_total_act_energy);
      push('b', val.b_total_act_energy);
      push('c', val.c_total_act_energy);
    } else if (/^em1data:\d+$/.test(key)) {
      push(`em1:${key.split(':')[1]}`, val.total_act_energy);
    } else if (/^input:\d+$/.test(key) && isRecord(val.counts)) {
      push(key, val.counts.total);
    }
  }
  if (out.length === 0) throw new AdapterError(`Shelly payload from ${src} carries no energy/pulse counters`);
  return out;
}

// ---------------------------------------------------------------- Generic JSON (Modbus gateways, simulator)

/**
 * `{ "readings": [ { "deviceId": "sdm120-07", "channel": "kwh", "readAt": "2026-10-08T10:00:00+02:00",
 *    "value": 1234.5, "eventId": "optional" } ] }` -- the shape a Teltonika "Data to Server" JSON
 * template, an ESPHome/Node-RED flow, or the simulator emits.
 */
export function parseGenericJson(body: unknown, receivedAt: Date): NormalisedReading[] {
  if (!isRecord(body) || !Array.isArray(body.readings)) {
    throw new AdapterError('Payload must be {"readings": [...]}');
  }
  if (body.readings.length > 500) throw new AdapterError('At most 500 readings per request');
  return body.readings.map((r, idx) => {
    if (!isRecord(r)) throw new AdapterError(`readings[${idx}] must be an object`);
    const deviceId = r.deviceId;
    if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 100) {
      throw new AdapterError(`readings[${idx}].deviceId is required`);
    }
    const value = finiteNonNegative(r.value);
    if (value === null) throw new AdapterError(`readings[${idx}].value must be a non-negative number`);
    const at = parseTime(r.readAt) ?? (r.readAt === undefined ? receivedAt : null);
    if (!at) throw new AdapterError(`readings[${idx}].readAt is not a valid timestamp`);
    const channel = typeof r.channel === 'string' ? r.channel.slice(0, 40) : '';
    const eventId =
      typeof r.eventId === 'string' && r.eventId.trim() ? r.eventId.slice(0, 200) : null;
    return { externalDeviceId: deviceId.trim(), channel, readAt: at, rawValue: value, eventId };
  });
}

export function parseProviderPayload(
  provider: MeterProvider,
  body: unknown,
  receivedAt: Date,
): NormalisedReading[] {
  switch (provider) {
    case 'milesight_lorawan':
      return parseMilesight(body, receivedAt);
    case 'shelly_gen2':
      return parseShelly(body, receivedAt);
    case 'generic_json':
    case 'simulator':
      return parseGenericJson(body, receivedAt);
  }
}
