// Static reference data for the Smart Utility module: municipalities (verified channels only) and the
// supported-hardware catalogue. Every municipal email address here was read on an official source on
// 2026-10-08 (docs/SMART_UTILITY_HARDWARE_RESEARCH.md §5). NEVER add an address that has not been
// verified on an official page -- the UI asks the owner to enter their own instead.

export type MunicipalChannelKind = 'email' | 'portal' | 'app' | 'whatsapp' | 'sms' | 'phone' | 'ivr';

export interface MunicipalChannel {
  kind: MunicipalChannelKind;
  /** Address / number / portal name exactly as published. */
  value: string;
  utility: 'water' | 'electricity' | 'both';
  note?: string;
}

export interface MunicipalityInfo {
  code: string;
  name: string;
  /** True when at least one verified email channel exists for self-submitted readings. */
  emailSubmission: boolean;
  channels: MunicipalChannel[];
  photo: 'required' | 'requested' | 'optional' | 'not_stated' | 'unknown';
  windowNote: string;
  requiredInfo: string;
  sourceUrl: string;
  verifiedOn: string;
  caveats: string[];
}

export const MUNICIPALITIES: MunicipalityInfo[] = [
  {
    code: 'ethekwini',
    name: 'eThekwini (Durban)',
    emailSubmission: false,
    channels: [
      { kind: 'portal', value: 'eThekwini eServices (electricity self-reading)', utility: 'electricity' },
      { kind: 'portal', value: 'eThekwini eServices water capture (login + photo)', utility: 'water' },
    ],
    photo: 'required',
    windowNote: 'Per-customer "read cycle days" shown after validation; readings are audited.',
    requiredInfo:
      'Electricity: E-number, meter number, name, contact number, reading date, Register 1/2. Water: account number, address, meter number, connection number, name, date/time, reading.',
    sourceUrl: 'https://ee-services.durban.gov.za/onlineservices/pages/mr/',
    verifiedOn: '2026-10-08',
    caveats: [
      'revlineresponse@durban.gov.za appears on the electricity page beside account details but is not stated to be the reading-submission address -- not pre-filled.',
      'Water photos must show the meter number.',
    ],
  },
  {
    code: 'johannesburg',
    name: 'City of Johannesburg (City Power / Johannesburg Water)',
    emailSubmission: true,
    channels: [
      { kind: 'email', value: 'estimations@citypower.co.za', utility: 'electricity', note: 'City Power' },
      { kind: 'portal', value: 'e-Joburg', utility: 'both' },
      { kind: 'phone', value: '0860 562 874', utility: 'both' },
    ],
    photo: 'requested',
    windowNote: 'Water page: one week before the billing date. Electricity: not clearly published.',
    requiredInfo: 'CoJ account number, meter number, reading, date and time.',
    sourceUrl:
      'https://joburg.org.za/media_/Newsroom/Pages/2025-News-Articles/How-to-submit-your-electricity-meter-readings.aspx',
    verifiedOn: '2026-10-08',
    caveats: [
      'Regional addresses regionA@joburg.org.za to regionG@joburg.org.za were published on 2024-05-16; choose your region yourself.',
      'Older official pages contradict the newer ones (online facility "disconnected", water by phone only).',
      'The City says it "may use" submitted readings.',
    ],
  },
  {
    code: 'cape_town',
    name: 'City of Cape Town',
    emailSubmission: true,
    channels: [
      { kind: 'email', value: 'Water.MeterReading@capetown.gov.za', utility: 'water' },
      { kind: 'email', value: 'accounts@capetown.gov.za', utility: 'electricity', note: 'Commercial electricity page' },
      { kind: 'whatsapp', value: '060 018 1505', utility: 'water' },
      { kind: 'sms', value: '31373', utility: 'water' },
      { kind: 'portal', value: 'City e-Services', utility: 'both' },
    ],
    photo: 'not_stated',
    windowNote: 'Water: a five-day window tied to your monthly billing cycle.',
    requiredInfo: 'Water: the black kilolitre digits. Other fields not stated.',
    sourceUrl: 'https://www.capetown.gov.za/Media-and-news/',
    verifiedOn: '2026-10-08',
    caveats: ['Submitting is "not compulsory"; smart (AMI) City meters need no reading.'],
  },
  {
    code: 'tshwane',
    name: 'City of Tshwane',
    emailSubmission: true,
    channels: [
      { kind: 'email', value: 'meterrecords@tshwane.gov.za', utility: 'both' },
      { kind: 'portal', value: 'e-Tshwane', utility: 'both' },
      { kind: 'phone', value: '012 358 9999 (option 2, then 4)', utility: 'both' },
    ],
    photo: 'not_stated',
    windowNote:
      'Five days before the billing date only (2026 billing calendars published); late readings are disregarded.',
    requiredInfo: 'Portion number (top left of the account); official template available.',
    sourceUrl: 'https://www.tshwane.gov.za/?page_id=199',
    verifiedOn: '2026-10-08',
    caveats: ['An inspector may visit at random to verify readings.', 'WhatsApp number is press-reported only.'],
  },
  {
    code: 'ekurhuleni',
    name: 'City of Ekurhuleni',
    emailSubmission: false,
    channels: [{ kind: 'app', value: 'My CoE app → Siyakhokha → Meter Systems', utility: 'both' }],
    photo: 'optional',
    windowNote: 'Per-township submission dates (2022 PDF; check it is current).',
    requiredInfo: 'Account and meter are selected in the app.',
    sourceUrl: 'https://www.ekurhuleni.gov.za/current-campaigns/you-can-now-submit-meter-readings-online/',
    verifiedOn: '2026-10-08',
    caveats: ['Siyakhokha@ekurhuleni.gov.za is a support address, not a submission channel.'],
  },
  {
    code: 'mangaung',
    name: 'Mangaung (water)',
    emailSubmission: true,
    channels: [{ kind: 'email', value: 'meterreadings@mangaung.co.za', utility: 'water' }],
    photo: 'required',
    windowNote: 'Municipal read cycle is days 1–12; self-submission window not stated.',
    requiredInfo: 'Account number; photo with the reading and account number visible.',
    sourceUrl: 'https://www.mangaung.co.za/2023/03/15/water-meter-reading-schedules/',
    verifiedOn: '2026-10-08',
    caveats: ['Source page is dated 2023-03-15. Electricity (Centlec) channel unknown.'],
  },
  {
    code: 'msunduzi',
    name: 'Msunduzi (Pietermaritzburg)',
    emailSubmission: true,
    channels: [{ kind: 'email', value: 'meter.readings@msunduzi.gov.za', utility: 'both' }],
    photo: 'unknown',
    windowNote: '1st to 10th of every month, no later than the 15th.',
    requiredInfo: 'Name, ID number, contact number, email, meter numbers and readings.',
    sourceUrl: 'http://www.msunduzi.gov.za/site/meter-reading-submission/',
    verifiedOn: '2026-10-08',
    caveats: ['The form asks for an ID number -- consider whether you are willing to share it by email.'],
  },
  {
    code: 'stellenbosch',
    name: 'Stellenbosch',
    emailSubmission: false,
    channels: [{ kind: 'app', value: 'My Municipal Meters App', utility: 'both' }],
    photo: 'unknown',
    windowNote: 'Not published.',
    requiredInfo: 'Unknown.',
    sourceUrl: 'https://stellenbosch.gov.za/download/my-municipal-meters-app/',
    verifiedOn: '2026-10-08',
    caveats: [],
  },
  {
    code: 'nelson_mandela_bay',
    name: 'Nelson Mandela Bay',
    emailSubmission: false,
    channels: [{ kind: 'ivr', value: 'IVR (register for voluntary meter readings)', utility: 'both' }],
    photo: 'unknown',
    windowNote: 'Unknown.',
    requiredInfo: 'Account number and ID/registration number (IVR registration).',
    sourceUrl:
      'https://www.nelsonmandelabay.gov.za/DataRepository/Documents/ivr-registration-form-june-2021_jFU7o.pdf',
    verifiedOn: '2026-10-08',
    caveats: [],
  },
  {
    code: 'other',
    name: 'Other municipality / Eskom direct',
    emailSubmission: false,
    channels: [],
    photo: 'unknown',
    windowNote: 'Enter your own submission window and recipient.',
    requiredInfo: 'Check your municipal account.',
    sourceUrl: '',
    verifiedOn: '2026-10-08',
    caveats: [
      'Buffalo City: no self-submission channel found. Polokwane: only a contractor address from about 2021 was found (not pre-filled).',
    ],
  },
];

export function getMunicipality(code: string | null | undefined): MunicipalityInfo | null {
  return MUNICIPALITIES.find((m) => m.code === code) ?? null;
}

// ---------------------------------------------------------------- hardware catalogue

export type Connectivity = 'manual' | 'lorawan' | 'wifi' | 'modbus_gateway' | 'http_push' | 'simulator';

export interface DeviceModel {
  manufacturer: string;
  model: string;
  utilityType: 'water' | 'electricity';
  connectivity: Connectivity;
  provider: 'milesight_lorawan' | 'shelly_gen2' | 'generic_json' | null;
  /** Suggested multiplier (base units per raw unit) and its meaning, editable per meter. */
  defaultMultiplier: number;
  multiplierNote: string;
  channels: { value: string; label: string }[];
  billingGrade: boolean;
  note: string;
}

export const DEVICE_MODELS: DeviceModel[] = [
  {
    manufacturer: 'Milesight',
    model: 'EM300-DI (pulse counter) on a pulse-output water meter',
    utilityType: 'water',
    connectivity: 'lorawan',
    provider: 'milesight_lorawan',
    defaultMultiplier: 0.5,
    multiplierNote: 'Litres per pulse of the water meter (0.5 L/pulse for the SA pulse-ready meters researched).',
    channels: [{ value: '', label: 'Pulse counter' }],
    billingGrade: false,
    note: 'Billing accuracy is that of the water meter itself; reconcile against the dial periodically.',
  },
  {
    manufacturer: 'Shelly',
    model: 'Plus Uni (pulse counter) on a pulse-output water meter',
    utilityType: 'water',
    connectivity: 'wifi',
    provider: 'shelly_gen2',
    defaultMultiplier: 0.5,
    multiplierNote: 'Litres per pulse of the water meter.',
    channels: [{ value: 'input:0', label: 'Input 0 (count mode)' }],
    billingGrade: false,
    note: 'Needs Wi-Fi and 5–28 V power at the meter.',
  },
  {
    manufacturer: 'Shelly',
    model: 'Pro 3EM (three-phase, CT)',
    utilityType: 'electricity',
    connectivity: 'wifi',
    provider: 'shelly_gen2',
    defaultMultiplier: 0.001,
    multiplierNote: 'kWh per Wh (Shelly reports Wh).',
    channels: [
      { value: 'total', label: 'Total (all phases)' },
      { value: 'a', label: 'Phase A' },
      { value: 'b', label: 'Phase B' },
      { value: 'c', label: 'Phase C' },
    ],
    billingGrade: false,
    note: 'Monitoring-grade (CT clamps, not MID). Do not use for tenant electricity billing.',
  },
  {
    manufacturer: 'Shelly',
    model: 'Pro EM-50 / EM Gen3 (single-phase, CT)',
    utilityType: 'electricity',
    connectivity: 'wifi',
    provider: 'shelly_gen2',
    defaultMultiplier: 0.001,
    multiplierNote: 'kWh per Wh.',
    channels: [
      { value: 'em1:0', label: 'Channel 0' },
      { value: 'em1:1', label: 'Channel 1' },
    ],
    billingGrade: false,
    note: 'Monitoring-grade (CT clamps, not MID).',
  },
  {
    manufacturer: 'Eastron',
    model: 'SDM120M / SDM630 via Modbus gateway',
    utilityType: 'electricity',
    connectivity: 'modbus_gateway',
    provider: 'generic_json',
    defaultMultiplier: 1,
    multiplierNote: 'Gateway sends the kWh register directly.',
    channels: [{ value: 'kwh', label: 'Import kWh' }],
    billingGrade: true,
    note: 'MID-certified (SDM120M). SA type approval for tenant rebilling is unverified.',
  },
  {
    manufacturer: 'CHINT',
    model: 'DDSU666 / DTSU666 via Modbus gateway',
    utilityType: 'electricity',
    connectivity: 'modbus_gateway',
    provider: 'generic_json',
    defaultMultiplier: 1,
    multiplierNote: 'Gateway sends the kWh register directly.',
    channels: [{ value: 'kwh', label: 'Import kWh' }],
    billingGrade: true,
    note: 'EN 50470 Class B (per search results). SA type approval unverified.',
  },
  {
    manufacturer: 'Other',
    model: 'Manual readings only',
    utilityType: 'water',
    connectivity: 'manual',
    provider: null,
    defaultMultiplier: 1,
    multiplierNote: 'Readings entered in litres.',
    channels: [{ value: '', label: '—' }],
    billingGrade: false,
    note: 'Use for municipal meters read by hand with a photo.',
  },
  {
    manufacturer: 'Other',
    model: 'Manual readings only',
    utilityType: 'electricity',
    connectivity: 'manual',
    provider: null,
    defaultMultiplier: 1,
    multiplierNote: 'Readings entered in kWh.',
    channels: [{ value: '', label: '—' }],
    billingGrade: false,
    note: 'Use for municipal meters read by hand with a photo.',
  },
];

/** Reading intervals the UI may offer per connectivity (minutes). */
export const INTERVALS_BY_CONNECTIVITY: Record<Connectivity, number[]> = {
  lorawan: [15, 60, 1440],
  wifi: [15, 60, 1440],
  modbus_gateway: [15, 60, 1440],
  http_push: [15, 60, 1440],
  simulator: [15, 60, 1440],
  manual: [1440, 43200],
};

export function intervalLabel(minutes: number): string {
  if (minutes === 15) return 'Every 15 minutes';
  if (minutes === 60) return 'Hourly';
  if (minutes === 1440) return 'Daily';
  if (minutes === 43200) return 'Monthly';
  return `${minutes} min`;
}
