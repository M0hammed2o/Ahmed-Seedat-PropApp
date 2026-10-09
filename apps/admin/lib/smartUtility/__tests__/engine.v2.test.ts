import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseChirpStack, parseTts, PROVIDERS, thingsboardPoll, thingsboardVerify, validateBaseUrl } from '../providers';
import { decryptCredentials, encryptCredentials, isCredentialsKeyConfigured, CredentialsKeyMissingError } from '../secrets';
import { computeCharge, validateBlocks } from '../tariffs';
import { DEFAULT_INCLUDE_FIELDS, normaliseFields, renderEmail, templateHash, unknownPlaceholders } from '../templates';
import { backoffMinutes } from '../sync';
import type { MunicipalReport } from '../municipalReport';
import { AdapterError } from '../adapters';

// Universal engine (providers, credential encryption, poll back-off), tariffs and templates.
// Provider payloads mirror the field names in the vendor docs cited in providers.ts.

const EM300_PULSE_10000 = Buffer.from([0x05, 0xc8, 0x10, 0x27, 0x00, 0x00]).toString('base64');

describe('ChirpStack v4 adapter', () => {
  const up = {
    deduplicationId: '3ac7e3c4-4401-4b8d-9386-a5c902f9202d',
    time: '2026-10-10T08:00:00.000Z',
    deviceInfo: { tenantId: 't', applicationId: 'a', deviceName: 'em300', devEui: '24e1241300000aa1', tags: {} },
    fCnt: 12,
    fPort: 85,
    data: EM300_PULSE_10000,
  };

  it('decodes a codec-less EM300-DI frame from base64 data as channel "pulse"', () => {
    const r = parseChirpStack(up, new Date(), new URLSearchParams('event=up'));
    expect(r).toEqual([
      expect.objectContaining({ externalDeviceId: '24E1241300000AA1', channel: 'pulse', rawValue: 10000 }),
    ]);
    expect(r[0]!.eventId).toBe('cs:3ac7e3c4-4401-4b8d-9386-a5c902f9202d:pulse');
    expect(r[0]!.readAt.toISOString()).toBe('2026-10-10T08:00:00.000Z');
  });

  it('uses every numeric field of a decoded object as a channel', () => {
    const r = parseChirpStack({ ...up, object: { pulse: 42, battery: 92, gpio: 'off' } }, new Date(), new URLSearchParams());
    expect(r.map((x) => [x.channel, x.rawValue])).toEqual([
      ['pulse', 42],
      ['battery', 92],
    ]);
  });

  it('acknowledges non-uplink events without readings', () => {
    expect(parseChirpStack({ anything: true }, new Date(), new URLSearchParams('event=join'))).toEqual([]);
  });

  it('rejects an uplink without devEui or without decodable data', () => {
    expect(() => parseChirpStack({ ...up, deviceInfo: {} }, new Date(), new URLSearchParams())).toThrow(AdapterError);
    expect(() => parseChirpStack({ ...up, data: 'AQI=' }, new Date(), new URLSearchParams())).toThrow(/codec/);
  });
});

describe('The Things Stack v3 adapter', () => {
  const msg = {
    end_device_ids: { device_id: 'em300', application_ids: { application_id: 'proplyst' }, dev_eui: '24E1241300000BB2' },
    received_at: '2026-10-10T08:00:01Z',
    uplink_message: { f_cnt: 7, f_port: 85, frm_payload: EM300_PULSE_10000, received_at: '2026-10-10T08:00:00Z' },
  };

  it('decodes frm_payload and prefers the network-server receive time', () => {
    const r = parseTts(msg, new Date());
    expect(r[0]).toMatchObject({ externalDeviceId: '24E1241300000BB2', channel: 'pulse', rawValue: 10000 });
    expect(r[0]!.readAt.toISOString()).toBe('2026-10-10T08:00:00.000Z');
  });

  it('uses decoded_payload fields when a formatter is configured', () => {
    const r = parseTts({ ...msg, uplink_message: { ...msg.uplink_message, decoded_payload: { water_counter: 1234.5 } } }, new Date());
    expect(r.map((x) => x.channel)).toEqual(['water_counter']);
  });

  it('ignores messages that are not uplinks', () => {
    expect(parseTts({ end_device_ids: {}, join_accept: {} }, new Date())).toEqual([]);
  });
});

describe('base URL SSRF guard', () => {
  it('accepts public https URLs and rejects http, private IPs, localhost, credentials and IPv6 literals', () => {
    expect(validateBaseUrl('https://tb.example.com').hostname).toBe('tb.example.com');
    for (const bad of ['http://tb.example.com', 'https://10.0.0.5', 'https://192.168.1.1', 'https://172.16.0.1', 'https://169.254.169.254', 'https://localhost', 'https://user:pw@tb.example.com', 'https://[::1]', 'not a url']) {
      expect(() => validateBaseUrl(bad)).toThrow(AdapterError);
    }
    expect(validateBaseUrl('http://localhost:8080', true).port).toBe('8080');
  });
});

describe('ThingsBoard poll adapter (mocked HTTP)', () => {
  const DEVICE = '0e3c1b30-5a5b-11ef-8a50-1b2c3d4e5f60';
  function mockFetch(handler: (url: URL, init?: RequestInit) => Response) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init)) as unknown as typeof fetch;
  }

  it('reads time-series values with an API key header and converts string values', async () => {
    const seen: { url: URL; auth: string | null }[] = [];
    const fetchImpl = mockFetch((url, init) => {
      seen.push({ url, auth: new Headers(init?.headers).get('X-Authorization') });
      return Response.json({ energy: [{ ts: 1791000000000, value: '1234.5' }, { ts: 1791000900000, value: '1235.0' }], other: [] });
    });
    const out = await thingsboardPoll(
      { config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'k1' }, fetchImpl },
      [{ deviceId: DEVICE, channel: 'energy' }],
      new Date(1790990000000),
      new Date(1791001000000),
    );
    expect(out.map((r) => r.rawValue)).toEqual([1234.5, 1235]);
    expect(out[0]!.eventId).toBe(`tb:${DEVICE}:energy:1791000000000`);
    expect(seen[0]!.auth).toBe('ApiKey k1');
    expect(seen[0]!.url.pathname).toBe(`/api/plugins/telemetry/DEVICE/${DEVICE}/values/timeseries`);
    expect(seen[0]!.url.searchParams.get('keys')).toBe('energy');
    expect(seen[0]!.url.searchParams.get('orderBy')).toBe('ASC');
  });

  it('falls back to the (deprecated) JWT login with username/password', async () => {
    const fetchImpl = mockFetch((url, init) => {
      if (url.pathname === '/api/auth/login') return Response.json({ token: 'jwt1', refreshToken: 'r' });
      expect(new Headers(init?.headers).get('X-Authorization')).toBe('Bearer jwt1');
      return Response.json({ energy: [] });
    });
    await thingsboardPoll({ config: { baseUrl: 'https://tb.example.com' }, credentials: { username: 'u', password: 'p' }, fetchImpl }, [{ deviceId: DEVICE, channel: 'energy' }], new Date(0), new Date());
  });

  it('surfaces HTTP failures as errors (so sync backs off) and verify reports bad credentials', async () => {
    const fail = mockFetch(() => new Response('nope', { status: 500 }));
    await expect(thingsboardPoll({ config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'k' }, fetchImpl: fail }, [{ deviceId: DEVICE, channel: 'energy' }], new Date(0), new Date())).rejects.toThrow(/HTTP 500/);
    const denied = mockFetch(() => new Response('', { status: 401 }));
    expect(await thingsboardVerify({ config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'bad' }, fetchImpl: denied })).toEqual({ ok: false, message: 'ThingsBoard rejected the credentials.' });
    const ok = mockFetch(() => Response.json({ id: { id: 'x' } }));
    expect((await thingsboardVerify({ config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'k' }, fetchImpl: ok })).ok).toBe(true);
  });

  it('rejects a non-UUID device id instead of building a path from it', async () => {
    const fetchImpl = mockFetch(() => Response.json({}));
    await expect(thingsboardPoll({ config: { baseUrl: 'https://tb.example.com' }, credentials: { apiKey: 'k' }, fetchImpl }, [{ deviceId: '../../admin', channel: 'energy' }], new Date(0), new Date())).rejects.toThrow(/not a UUID/);
  });
});

describe('provider registry honesty', () => {
  it('labels every hardware path as needing hardware testing and only Proplyst JSON as verified', () => {
    const levels = Object.fromEntries(Object.values(PROVIDERS).map((p) => [p.id, p.verification]));
    expect(levels).toEqual({
      milesight_lorawan: 'needs_hardware_testing',
      chirpstack_v4: 'needs_hardware_testing',
      tts_v3: 'needs_hardware_testing',
      shelly_gen2: 'needs_hardware_testing',
      generic_json: 'verified',
      simulator: 'simulated',
      thingsboard: 'needs_hardware_testing',
    });
  });
});

describe('credential encryption', () => {
  const original = process.env.SMART_UTILITY_CREDENTIALS_KEY;
  beforeEach(() => {
    process.env.SMART_UTILITY_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SMART_UTILITY_CREDENTIALS_KEY;
    else process.env.SMART_UTILITY_CREDENTIALS_KEY = original;
  });

  it('round-trips, never contains the plaintext, and is bound to its row (AAD)', () => {
    const env = encryptCredentials({ apiKey: 'super-secret-value' }, 'row-1');
    expect(env.startsWith('v1:')).toBe(true);
    expect(env).not.toContain('super-secret-value');
    expect(decryptCredentials(env, 'row-1')).toEqual({ apiKey: 'super-secret-value' });
    expect(() => decryptCredentials(env, 'row-2')).toThrow();
  });

  it('detects tampering and uses a fresh IV each time', () => {
    const a = encryptCredentials({ k: 'v' }, 'r');
    const b = encryptCredentials({ k: 'v' }, 'r');
    expect(a).not.toBe(b);
    const parts = a.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptCredentials(parts.join(':'), 'r')).toThrow();
  });

  it('fails closed without a key', () => {
    delete process.env.SMART_UTILITY_CREDENTIALS_KEY;
    expect(isCredentialsKeyConfigured()).toBe(false);
    expect(() => encryptCredentials({ k: 'v' }, 'r')).toThrow(CredentialsKeyMissingError);
  });
});

describe('poll back-off', () => {
  it('doubles the interval per failure and caps at 24 h', () => {
    expect([0, 1, 2, 3].map((f) => backoffMinutes(60, f))).toEqual([60, 120, 240, 480]);
    expect(backoffMinutes(60, 10)).toBe(1440);
  });
});

describe('tariffs', () => {
  const blocks = [
    { upTo: 6, rate: 20 },
    { upTo: 10.5, rate: 30 },
    { upTo: null, rate: 50 },
  ];
  it('applies stepped blocks plus a fixed charge', () => {
    // 6×20 + 4.5×30 + 1.5×50 = 120 + 135 + 75 = 330; + 85 fixed = 415
    const c = computeCharge(12, { fixedCharge: 85, blocks });
    expect(c.usageAmount).toBe(330);
    expect(c.total).toBe(415);
    expect(c.breakdown.map((l) => l.units)).toEqual([6, 4.5, 1.5]);
  });
  it('charges only the fixed amount for zero use and validates block order', () => {
    expect(computeCharge(0, { fixedCharge: 50, blocks }).total).toBe(50);
    expect(validateBlocks([{ upTo: 5, rate: 1 }, { upTo: 3, rate: 2 }, { upTo: null, rate: 3 }])).toMatch(/greater than 5/);
    expect(validateBlocks([{ upTo: 5, rate: 1 }])).toMatch(/open-ended/);
    expect(() => computeCharge(-1, { fixedCharge: 0, blocks })).toThrow();
  });
});

describe('municipal templates', () => {
  const report: MunicipalReport = {
    version: 1,
    generatedAt: '2026-10-20T08:00:00Z',
    property: { name: 'Block A', address: '1 Meter St, Pretoria' },
    preparedFor: 'Acme Properties',
    municipality: { code: 'tshwane', name: 'City of Tshwane' },
    municipalAccountNumber: '5001234567',
    period: { start: '2026-09-25', end: '2026-10-24' },
    meters: [
      {
        meterId: 'm1', utilityType: 'water', meterNumber: 'TSH-W-1', serialNumber: 'SN9', unit: 'kL',
        previousReading: 1010, previousReadingAt: '2026-09-24T10:00:00Z', currentReading: 1035.5,
        currentReadingAt: '2026-10-20T10:00:00Z', consumption: 25.5, verification: 'photo_verified',
        verificationNote: 'Read from the municipal meter; photo evidence on file.', evidenceDocumentIds: [],
      },
    ],
    notes: [],
  };
  const base = { subjectTemplate: null, bodyTemplate: null, includeFields: DEFAULT_INCLUDE_FIELDS, customMessage: 'Gate code 1234', accountHolderName: 'J Smith', ccEmails: [], recipients: ['agent@example.com'] };

  it('renders the default template with readings, account and custom message', () => {
    const e = renderEmail(report, base);
    expect(e.subject).toBe('Meter readings for 1 Meter St, Pretoria — account 5001234567 (2026-10-24)');
    // en-ZA groups thousands with a (non-breaking) space: "1 010".
    expect(e.bodyText).toMatch(/Previous reading: 1\s010 kL on 2026-09-24/);
    expect(e.bodyText).toMatch(/Current reading: 1\s035[.,]5 kL on 2026-10-20/);
    expect(e.bodyText).toMatch(/Consumption: 25[.,]5 kL/); // en-ZA decimal comma
    expect(e.bodyText).toContain('Gate code 1234');
  });

  it('honours field toggles', () => {
    const e = renderEmail(report, { ...base, includeFields: { ...DEFAULT_INCLUDE_FIELDS, previousReading: false, consumption: false, accountNumber: false } });
    expect(e.bodyText).not.toContain('Previous reading');
    expect(e.bodyText).not.toContain('Consumption:');
    expect(e.subject).toContain('(not included)');
  });

  it('changes the approval hash when ANY sent content changes, and not for reordering', () => {
    const h = templateHash(base);
    expect(templateHash({ ...base })).toBe(h);
    expect(templateHash({ ...base, customMessage: 'Gate code 9999' })).not.toBe(h);
    expect(templateHash({ ...base, recipients: ['other@example.com'] })).not.toBe(h);
    expect(templateHash({ ...base, ccEmails: ['cc@example.com'] })).not.toBe(h);
    expect(templateHash({ ...base, includeFields: { ...DEFAULT_INCLUDE_FIELDS, photos: false } })).not.toBe(h);
    expect(templateHash({ ...base, recipients: ['B@x.com', 'a@x.com'] })).toBe(templateHash({ ...base, recipients: ['a@x.com', 'b@x.com'] }));
  });

  it('flags unknown placeholders and normalises stored field toggles', () => {
    expect(unknownPlaceholders('Hi {{property_name}} {{bank_details}}')).toEqual(['bank_details']);
    expect(normaliseFields({ photos: false, junk: 1 })).toEqual({ ...DEFAULT_INCLUDE_FIELDS, photos: false });
  });
});
