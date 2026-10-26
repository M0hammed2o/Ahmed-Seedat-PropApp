// The demo organisation's year of operations, as DATA (docs/CEMETERY_MANAGEMENT.md §Demo). Pure and deterministic:
// the same inputs always give the same plan, so the provisioner can replay it idempotently and the unit tests can
// prove it is chronological, never future-dated, never sells a site twice and reconciles to the cent.
//
// History window: 1 November 2025 → 31 October 2026, capped at `today` (nothing is ever dated after it).
// Every person, business and amount is fictional.

export const HISTORY_START = '2025-11-01';
export const HISTORY_END = '2026-10-31';

const DAY = 86_400_000;
export const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export function addMonths(d: string, n: number, day?: number): string {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day ?? dd, last)).padStart(2, '0')}`;
}
export const monthsOfHistory = (today: string) => {
  const out: string[] = [];
  for (let m = HISTORY_START; m <= HISTORY_END && m <= today; m = addMonths(m, 1, 1)) out.push(m);
  return out;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic pseudo-random in [0, 1). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

// ============================================================================================ rental
export type RentPay = { day: number; pct?: number } | { on: string; pct?: number };
export interface Tenancy {
  tenant: string;
  start: string;
  /** Last day of the lease (inclusive). */
  end: string;
  rent: number;
  /** Status the lease ends the year in: active, expired (ran its term) or terminated (ended early). */
  final: 'active' | 'expired' | 'terminated';
  payDay?: number;
  method?: 'eft' | 'debit_order' | 'cash' | 'card' | 'bank_deposit';
  /** Per due month (YYYY-MM): how it was actually paid. [] = not paid (arrears). */
  exceptions?: Record<string, RentPay[]>;
}
export interface UnitPlan {
  label: string;
  beds?: number;
  sqm: number;
  marketRent: number;
  tenancies: Tenancy[];
}
export interface PropertyPlan {
  key: 'res' | 'com';
  nickname: string;
  address: string;
  suburb: string;
  city: string;
  postal: string;
  type: 'apartment_building' | 'commercial';
  units: UnitPlan[];
}

export const PROPERTIES: PropertyPlan[] = [
  {
    key: 'res',
    nickname: 'Riverside Heights Apartments',
    address: '22 Riverside Road',
    suburb: 'Pinetown',
    city: 'Durban',
    postal: '3610',
    type: 'apartment_building',
    units: [
      {
        label: 'Unit 101',
        beds: 1,
        sqm: 48,
        marketRent: 7250,
        tenancies: [
          {
            tenant: 'Thandeka Mthembu',
            start: '2025-03-01',
            end: '2026-02-28',
            rent: 6800,
            final: 'expired',
          },
          {
            tenant: 'Thandeka Mthembu',
            start: '2026-03-01',
            end: '2027-02-28',
            rent: 7250,
            final: 'active',
          },
        ],
      },
      {
        label: 'Unit 102',
        beds: 2,
        sqm: 72,
        marketRent: 9950,
        tenancies: [
          {
            tenant: 'Johan and Elsa Pretorius',
            start: '2024-08-01',
            end: '2026-07-31',
            rent: 9400,
            final: 'expired',
            payDay: 12,
          },
          {
            tenant: 'Johan and Elsa Pretorius',
            start: '2026-08-01',
            end: '2027-07-31',
            rent: 9950,
            final: 'active',
            payDay: 12,
          },
        ],
      },
      {
        label: 'Unit 103',
        beds: 2,
        sqm: 70,
        marketRent: 9200,
        tenancies: [
          {
            tenant: 'Sibusiso Ngcobo',
            start: '2025-11-01',
            end: '2026-10-31',
            rent: 9200,
            final: 'active',
            exceptions: { '2026-08': [{ day: 21 }], '2026-10': [] },
          },
        ],
      },
      {
        label: 'Unit 104',
        beds: 1,
        sqm: 50,
        marketRent: 7100,
        tenancies: [
          {
            tenant: 'Naledi Dube',
            start: '2026-03-01',
            end: '2027-02-28',
            rent: 7100,
            final: 'active',
            method: 'debit_order',
          },
        ],
      },
      {
        label: 'Unit 105',
        beds: 3,
        sqm: 96,
        marketRent: 13600,
        tenancies: [
          {
            tenant: 'Ravi and Anjali Govender',
            start: '2025-06-01',
            end: '2026-05-31',
            rent: 12900,
            final: 'expired',
            method: 'debit_order',
          },
          {
            tenant: 'Ravi and Anjali Govender',
            start: '2026-06-01',
            end: '2027-05-31',
            rent: 13600,
            final: 'active',
            method: 'debit_order',
          },
        ],
      },
      {
        label: 'Unit 106',
        beds: 2,
        sqm: 74,
        marketRent: 9600,
        tenancies: [
          {
            tenant: 'Michael Adams',
            start: '2025-02-01',
            end: '2026-01-31',
            rent: 9300,
            final: 'expired',
            exceptions: { '2026-01': [{ on: '2026-02-11' }] },
          },
          {
            tenant: 'Karabo Molefe',
            start: '2026-02-01',
            end: '2027-01-31',
            rent: 9600,
            final: 'active',
          },
        ],
      },
      {
        label: 'Unit 201',
        beds: 1,
        sqm: 48,
        marketRent: 7350,
        tenancies: [
          {
            tenant: 'Megan Fourie',
            start: '2025-09-01',
            end: '2026-08-31',
            rent: 7000,
            final: 'expired',
          },
          {
            tenant: 'Megan Fourie',
            start: '2026-09-01',
            end: '2027-08-31',
            rent: 7350,
            final: 'active',
            exceptions: { '2026-10': [{ day: 4, pct: 0.5 }] },
          },
        ],
      },
      {
        label: 'Unit 202',
        beds: 2,
        sqm: 72,
        marketRent: 9500,
        tenancies: [
          {
            tenant: 'Lwazi Zulu',
            start: '2025-01-01',
            end: '2026-12-31',
            rent: 9500,
            final: 'active',
            method: 'debit_order',
          },
        ],
      },
      {
        label: 'Unit 203',
        beds: 2,
        sqm: 70,
        marketRent: 9600,
        tenancies: [
          {
            tenant: 'Ruan Venter',
            start: '2025-05-01',
            end: '2026-04-30',
            rent: 9300,
            final: 'expired',
          },
        ],
      },
      {
        label: 'Unit 204',
        beds: 3,
        sqm: 98,
        marketRent: 12500,
        tenancies: [
          {
            tenant: 'Fatima Ebrahim',
            start: '2024-12-01',
            end: '2026-11-30',
            rent: 12500,
            final: 'active',
          },
        ],
      },
      {
        label: 'Unit 205',
        beds: 2,
        sqm: 74,
        marketRent: 9800,
        tenancies: [
          {
            tenant: 'Pieter Botha',
            start: '2026-04-01',
            end: '2027-03-31',
            rent: 9800,
            final: 'active',
          },
        ],
      },
      {
        label: 'Unit 206',
        beds: 1,
        sqm: 52,
        marketRent: 7400,
        tenancies: [
          {
            tenant: 'Sarah Nel',
            start: '2025-01-01',
            end: '2026-06-30',
            rent: 7200,
            final: 'terminated',
            exceptions: {
              '2026-05': [
                { day: 3, pct: 0.5 },
                { on: '2026-06-19', pct: 0.5 },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    key: 'com',
    nickname: 'Northgate Business Centre',
    address: '8 Northgate Avenue',
    suburb: 'Westville',
    city: 'Durban',
    postal: '3629',
    type: 'commercial',
    units: [
      {
        label: 'Shop 1',
        sqm: 120,
        marketRent: 28500,
        tenancies: [
          {
            tenant: 'Northgate Family Pharmacy (Pty) Ltd',
            start: '2024-07-01',
            end: '2027-06-30',
            rent: 28500,
            final: 'active',
            payDay: 1,
          },
        ],
      },
      {
        label: 'Shop 2',
        sqm: 85,
        marketRent: 18500,
        tenancies: [
          {
            tenant: 'Bean & Leaf Coffee Co. CC',
            start: '2025-02-01',
            end: '2028-01-31',
            rent: 18500,
            final: 'active',
            payDay: 9,
            exceptions: { '2026-02': [{ on: '2026-03-06' }] },
          },
        ],
      },
      {
        label: 'Suite 101',
        sqm: 140,
        marketRent: 24000,
        tenancies: [
          {
            tenant: 'Khumalo & Partners Attorneys Inc.',
            start: '2024-04-01',
            end: '2029-03-31',
            rent: 24000,
            final: 'active',
          },
        ],
      },
      {
        label: 'Suite 102',
        sqm: 110,
        marketRent: 19800,
        tenancies: [
          {
            tenant: 'Ubuntu Digital Solutions (Pty) Ltd',
            start: '2025-08-01',
            end: '2028-07-31',
            rent: 19800,
            final: 'active',
            exceptions: { '2026-10': [] },
          },
        ],
      },
      {
        label: 'Suite 201',
        sqm: 160,
        marketRent: 26500,
        tenancies: [
          {
            tenant: 'Coastal Insurance Brokers CC',
            start: '2023-12-01',
            end: '2026-03-31',
            rent: 26500,
            final: 'expired',
          },
        ],
      },
      {
        label: 'Warehouse A',
        sqm: 420,
        marketRent: 42000,
        tenancies: [
          {
            tenant: 'Coastline Logistics CC',
            start: '2024-10-01',
            end: '2027-09-30',
            rent: 42000,
            final: 'active',
            exceptions: {
              '2026-06': [
                { day: 5, pct: 0.5 },
                { on: '2026-07-08', pct: 0.5 },
              ],
              '2026-09': [],
              '2026-10': [],
            },
          },
        ],
      },
    ],
  },
];

export interface PlannedRentPayment {
  dueDate: string;
  amount: number;
  paidOn: string;
  method: string;
  reference: string;
}

/** Rent due dates (1st of each month) of a tenancy inside the history window, capped at today. */
export function dueDates(t: Tenancy, today: string): string[] {
  return monthsOfHistory(today).filter(
    (m) => m >= t.start.slice(0, 7) + '-01' && m <= t.end && m <= today,
  );
}

export function rentPayments(unit: string, t: Tenancy, today: string): PlannedRentPayment[] {
  const out: PlannedRentPayment[] = [];
  for (const due of dueDates(t, today)) {
    const month = due.slice(0, 7);
    const plan = t.exceptions?.[month] ?? [{ day: t.payDay ?? 2 }];
    plan.forEach((p, i) => {
      const paidOn = 'on' in p ? p.on : `${month}-${String(p.day).padStart(2, '0')}`;
      if (paidOn > today) return; // not paid yet
      out.push({
        dueDate: due,
        amount: r2(t.rent * (p.pct ?? 1)),
        paidOn,
        method: t.method ?? (i === 0 ? 'eft' : 'eft'),
        reference: `DEMO-RENT-${unit.replace(/\s+/g, '')}-${month.replace('-', '')}${i ? `-${i + 1}` : ''}`,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- expenses
export interface PlannedExpense {
  property: 'res' | 'com';
  date: string;
  category: string;
  categoryCode:
    | 'rates_taxes'
    | 'levies'
    | 'water'
    | 'electricity'
    | 'maintenance'
    | 'security'
    | 'insurance'
    | 'cleaning'
    | 'management'
    | 'other';
  amount: number;
  reference: string;
  notes: string;
}

const RECURRING: Record<
  'res' | 'com',
  {
    day: number;
    category: string;
    code: PlannedExpense['categoryCode'];
    base: number;
    vary?: number;
    label: string;
  }[]
> = {
  res: [
    { day: 2, category: 'Insurance', code: 'insurance', base: 2950, label: 'INS' },
    { day: 5, category: 'Security', code: 'security', base: 6200, label: 'SEC' },
    { day: 7, category: 'Rates & taxes', code: 'rates_taxes', base: 4850, label: 'RATES' },
    { day: 18, category: 'Electricity', code: 'electricity', base: 1800, vary: 650, label: 'ELEC' },
    { day: 18, category: 'Water', code: 'water', base: 1350, vary: 550, label: 'WATER' },
    { day: 20, category: 'Garden services', code: 'other', base: 1650, label: 'GARDEN' },
    { day: 25, category: 'Cleaning', code: 'cleaning', base: 3400, label: 'CLEAN' },
  ],
  com: [
    { day: 2, category: 'Insurance', code: 'insurance', base: 5600, label: 'INS' },
    { day: 5, category: 'Security', code: 'security', base: 8900, label: 'SEC' },
    { day: 7, category: 'Rates & taxes', code: 'rates_taxes', base: 11200, label: 'RATES' },
    { day: 18, category: 'Electricity', code: 'electricity', base: 3600, vary: 700, label: 'ELEC' },
    { day: 18, category: 'Water', code: 'water', base: 1200, vary: 400, label: 'WATER' },
    { day: 25, category: 'Cleaning', code: 'cleaning', base: 4100, label: 'CLEAN' },
  ],
};

const ONE_OFF: Omit<PlannedExpense, 'reference' | 'categoryCode' | 'category'>[] = [
  { property: 'res', date: '2025-12-05', amount: 9800, notes: 'Geyser replacement, Unit 102' },
  { property: 'res', date: '2026-02-12', amount: 3450, notes: 'Gate motor repair' },
  { property: 'res', date: '2026-05-14', amount: 7200, notes: 'Repaint Unit 203 after move-out' },
  {
    property: 'res',
    date: '2026-07-16',
    amount: 12400,
    notes: 'Unit 206 refurbishment before re-letting',
  },
  { property: 'res', date: '2026-09-11', amount: 2150, notes: 'Stairwell lighting replaced' },
  { property: 'res', date: '2026-10-22', amount: 1450, notes: 'Geyser leak call-out, Unit 103' },
  { property: 'com', date: '2025-11-12', amount: 4200, notes: 'Roller door service, Warehouse A' },
  { property: 'com', date: '2026-01-22', amount: 12800, notes: 'Parking bay line marking' },
  {
    property: 'com',
    date: '2026-03-06',
    amount: 3200,
    notes: 'Air-conditioner service, Suite 101',
  },
  {
    property: 'com',
    date: '2026-05-08',
    amount: 9600,
    notes: 'Suite 201 cleaning and repaint after tenant left',
  },
  { property: 'com', date: '2026-08-14', amount: 14500, notes: 'Roof leak repair above Shop 2' },
  {
    property: 'com',
    date: '2026-10-13',
    amount: 7450,
    notes: 'Roller door motor replacement, Warehouse A',
  },
];

export function expenses(today: string): PlannedExpense[] {
  const r = rng(20251101);
  const out: PlannedExpense[] = [];
  for (const month of monthsOfHistory(today)) {
    for (const key of ['res', 'com'] as const) {
      for (const e of RECURRING[key]) {
        const date = `${month.slice(0, 7)}-${String(e.day).padStart(2, '0')}`;
        const amount = r2(e.base + (e.vary ? Math.round(r() * e.vary) : 0));
        if (date > today) continue;
        out.push({
          property: key,
          date,
          category: e.category,
          categoryCode: e.code,
          amount,
          reference: `DEMO-EXP-${key.toUpperCase()}-${month.slice(0, 7).replace('-', '')}-${e.label}`,
          notes: `Fictional demonstration expense — ${e.category.toLowerCase()}`,
        });
      }
    }
  }
  ONE_OFF.forEach((e, i) => {
    if (e.date > today) return;
    out.push({
      ...e,
      category: 'Maintenance',
      categoryCode: 'maintenance',
      reference: `DEMO-EXP-${e.property.toUpperCase()}-REPAIR-${i + 1}`,
      notes: `${e.notes} (fictional)`,
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface PlannedTicket {
  property: 'res' | 'com';
  unit: string | null;
  opened: string;
  summary: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'to_do' | 'in_progress' | 'pending_approval' | 'completed';
  resolved?: string;
}

export const TICKETS: PlannedTicket[] = [
  {
    property: 'res',
    unit: 'Unit 202',
    opened: '2025-11-14',
    summary: 'Blocked drain in bathroom',
    description: 'Shower drain slow; plumber cleared the trap.',
    priority: 'low',
    status: 'completed',
    resolved: '2025-11-17',
  },
  {
    property: 'res',
    unit: 'Unit 102',
    opened: '2025-12-04',
    summary: 'Geyser burst',
    description: 'Geyser burst overnight; replaced with a 150 L unit.',
    priority: 'urgent',
    status: 'completed',
    resolved: '2025-12-05',
  },
  {
    property: 'res',
    unit: null,
    opened: '2026-02-09',
    summary: 'Gate motor intermittent',
    description: 'Vehicle gate sometimes fails to open with remotes.',
    priority: 'high',
    status: 'completed',
    resolved: '2026-02-12',
  },
  {
    property: 'res',
    unit: 'Unit 105',
    opened: '2026-03-18',
    summary: 'Bedroom window latch broken',
    description: 'Main bedroom window will not lock.',
    priority: 'medium',
    status: 'completed',
    resolved: '2026-03-24',
  },
  {
    property: 'res',
    unit: 'Unit 203',
    opened: '2026-05-06',
    summary: 'Repaint after move-out',
    description: 'Walls and ceilings repainted for re-letting.',
    priority: 'medium',
    status: 'completed',
    resolved: '2026-05-14',
  },
  {
    property: 'res',
    unit: 'Unit 206',
    opened: '2026-07-03',
    summary: 'Refurbishment before re-letting',
    description: 'Kitchen cupboard doors, flooring and paint.',
    priority: 'medium',
    status: 'in_progress',
  },
  {
    property: 'res',
    unit: null,
    opened: '2026-09-08',
    summary: 'Stairwell lights not working',
    description: 'Two LED fittings on the 2nd-floor stairwell.',
    priority: 'medium',
    status: 'completed',
    resolved: '2026-09-11',
  },
  {
    property: 'res',
    unit: 'Unit 202',
    opened: '2026-10-15',
    summary: 'Kitchen tap dripping',
    description: 'Mixer tap drips constantly; washer likely worn.',
    priority: 'low',
    status: 'in_progress',
  },
  {
    property: 'res',
    unit: 'Unit 103',
    opened: '2026-10-21',
    summary: 'Geyser leaking into ceiling',
    description: 'Water dripping from the bathroom ceiling below the geyser.',
    priority: 'urgent',
    status: 'to_do',
  },
  {
    property: 'com',
    unit: 'Warehouse A',
    opened: '2025-11-10',
    summary: 'Roller door service',
    description: 'Annual service of the two roller doors.',
    priority: 'low',
    status: 'completed',
    resolved: '2025-11-12',
  },
  {
    property: 'com',
    unit: null,
    opened: '2026-01-20',
    summary: 'Parking bay line marking',
    description: 'Repaint 24 bays and the loading zone.',
    priority: 'medium',
    status: 'completed',
    resolved: '2026-01-22',
  },
  {
    property: 'com',
    unit: 'Suite 101',
    opened: '2026-03-05',
    summary: 'Air-conditioner service due',
    description: 'Annual service for the two split units.',
    priority: 'low',
    status: 'completed',
    resolved: '2026-03-06',
  },
  {
    property: 'com',
    unit: 'Shop 2',
    opened: '2026-08-12',
    summary: 'Roof leak above shop',
    description: 'Leak at a roof-sheet overlap after heavy rain.',
    priority: 'high',
    status: 'completed',
    resolved: '2026-08-14',
  },
  {
    property: 'com',
    unit: 'Warehouse A',
    opened: '2026-10-12',
    summary: 'Roller door motor fault',
    description: 'Door stops halfway; tenant using the manual chain.',
    priority: 'high',
    status: 'pending_approval',
  },
  {
    property: 'com',
    unit: 'Suite 201',
    opened: '2026-10-23',
    summary: 'Pre-letting inspection',
    description: 'Inspect the vacant suite before marketing.',
    priority: 'low',
    status: 'to_do',
  },
];

// ============================================================================================ cemetery
export const FIRST = [
  'Priya',
  'Themba',
  'Hendrik',
  'Zanele',
  'Mohammed',
  'Grace',
  'David',
  'Nokuthula',
  'Anand',
  'Lerato',
  'Margaret',
  'Bongani',
  'Shirley',
  'Jan',
  'Ayanda',
  'Fatima',
  'Peter',
  'Charmaine',
  'Sanele',
  'Ruth',
  'Vusi',
  'Elizabeth',
  'Kumaran',
  'Busisiwe',
  'Simon',
  'Nadia',
  'Kavitha',
  'Graham',
  'Lindiwe',
  'Andries',
  'Yusuf',
  'Thabo',
  'Marlene',
  'Sipho',
  'Reshma',
  'Willem',
  'Nomvula',
  'Rajesh',
  'Carol',
  'Mandla',
  'Zainab',
  'Gerrit',
  'Palesa',
  'Dev',
  'Linda',
  'Musa',
  'Ilse',
  'Farouk',
  'Thandiwe',
  'Bradley',
  'Aaliyah',
  'Johannes',
  'Precious',
  'Vikesh',
  'Annette',
  'Lungelo',
];
export const LAST = [
  'Naidoo',
  'Dlamini',
  'van Wyk',
  'Khumalo',
  'Cassim',
  'Mokoena',
  'Smith',
  'Mkhize',
  'Pillay',
  'Sithole',
  "O'Brien",
  'Zungu',
  'Govender',
  'Steyn',
  'Ngubane',
  'Moosa',
  'Mahlangu',
  'Adams',
  'Cele',
  'Abrahams',
  'Shabalala',
  'Joubert',
  'Reddy',
  'Majola',
  'Nkosi',
  'Hendricks',
  'Moodley',
  'Pillai',
  'Ndlovu',
  'Botha',
  'Ismail',
  'Mabaso',
  'Coetzee',
  'Zwane',
  'Singh',
  'Venter',
  'Mthethwa',
  'Maharaj',
  'Daniels',
  'Gumede',
  'Essop',
  'Kruger',
  'Molefe',
  'Chetty',
  'Barnard',
  'Buthelezi',
  'Swart',
  'Jacobs',
  'Mthembu',
  'Lombard',
  'Patel',
  'Nel',
  'Mavuso',
  'Ramlall',
  'de Klerk',
  'Shezi',
];
export const HOLDERS = FIRST.map((f, i) => `${f} ${LAST[i]}`);
const RELATION = ['Son', 'Daughter', 'Wife', 'Husband', 'Brother', 'Sister', 'Nephew', 'Niece'];

export interface PlannedHolder {
  name: string;
  phone: string;
  email: string;
  address: string;
  nok: [string, string, string] | null;
}
export function holders(): PlannedHolder[] {
  const suburbs = [
    'Hillcrest',
    'Kloof',
    'Pinetown',
    'Westville',
    'Gillitts',
    'Waterfall',
    "Botha's Hill",
    'Assagay',
  ];
  return HOLDERS.map((name, i) => ({
    name,
    phone: `031 555 ${String(101 + i * 2).padStart(4, '0')}`,
    email: `${name
      .toLowerCase()
      .replace(/[^a-z]+/g, '.')
      .replace(/^\.|\.$/g, '')}@demo.proplyst.invalid`,
    address: `${3 + ((i * 7) % 60)} ${['Jacaranda', 'Protea', 'Ridge', 'Old Main', 'Kingfisher', 'Valley View'][i % 6]} Road, ${suburbs[i % suburbs.length]} (fictional)`,
    nok:
      i % 3 === 2
        ? null
        : [
            `${FIRST[(i + 17) % FIRST.length]} ${LAST[i]}`,
            `031 555 ${String(102 + i * 2).padStart(4, '0')}`,
            RELATION[i % RELATION.length]!,
          ],
  }));
}

const DECEASED_FIRST = [
  'Rajesh',
  'Sarah',
  'Elias',
  'Johanna',
  'Cornelius',
  'Bheki',
  'Yusuf',
  'Agnes',
  'Robert',
  'Mary',
  'Jabulani',
  'Saroja',
  'Patrick',
  'Thokozani',
  'Logan',
  'Maria',
  'Dumisani',
  'Ismail',
  'Samuel',
  'George',
  'Ntombi',
  'Isaac',
  'Phumzile',
  'Andries',
  'Gopal',
  'Hannah',
  'Lionel',
  'Gladys',
  'Moses',
  'Doreen',
  'Ebrahim',
  'Rose',
  'Petrus',
  'Beauty',
  'Krishna',
  'Eileen',
];
const UNDERTAKERS = [
  'Hillcrest Funeral Services (fictional)',
  'Valley Memorial Undertakers (fictional)',
  'Ubuntu Funeral Parlour (fictional)',
  'Highway Family Funerals (fictional)',
];

export type CemAct =
  | { k: 'withdraw'; date: string; site: string; reason: string }
  | { k: 'return'; date: string; site: string }
  | { k: 'reserve'; date: string; site: string; holder: string; until: string; notes: string }
  | { k: 'release'; date: string; site: string }
  | {
      k: 'sale';
      date: string;
      site: string;
      holder: string;
      price: number;
      deposit: number;
      method: 'eft' | 'card' | 'cash' | 'bank_transfer';
      key: string;
    }
  | {
      k: 'pay';
      date: string;
      key: string;
      amount: number;
      ref: string;
      method: 'eft' | 'card' | 'cash' | 'bank_transfer';
    }
  | { k: 'cancel'; date: string; key: string; reason: string }
  | {
      k: 'burial';
      date: string;
      site: string;
      n: number;
      name: string;
      dob: string;
      dod: string;
      undertaker: string;
    };

const ORDER: Record<CemAct['k'], number> = {
  withdraw: 0,
  return: 0,
  release: 1,
  reserve: 2,
  sale: 3,
  pay: 4,
  burial: 5,
  cancel: 6,
};
export const ref = (site: string, n: number) => `DEMO-${site}-${n}`;
export const saleKey = (site: string, date: string) => `${site}@${date}`;

/** List price by section and site type on a given date (tariff increases each 1 July). */
export function listPrice(site: string, date: string): number {
  const [sec, numStr] = site.split('-') as [string, string];
  const n = Number(numStr);
  const year = Number(date.slice(0, 4)) - (date.slice(5) < '07-01' ? 1 : 0); // tariff year starting 1 July
  const base =
    sec === 'A'
      ? n >= 21 && n <= 24
        ? 24500
        : 18500
      : sec === 'B'
        ? 14500
        : n >= 36 && n <= 39
          ? 6500
          : 11500;
  const factor = Math.pow(1.05, year - 2025); // 2025/26 tariff = base
  return Math.round((base * factor) / 50) * 50;
}

export interface CemeteryPlan {
  acts: CemAct[];
  doubleSites: string[];
  cremationSites: string[];
}

/** The whole cemetery timeline: an opening register (sales and burials before November 2025, captured when the
 * cemetery started using Proplyst) followed by twelve months of activity. Sorted chronologically. */
export function cemeteryPlan(today: string): CemeteryPlan {
  const r = rng(20251102);
  const acts: CemAct[] = [];
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  let deceased = 0;
  const burial = (site: string, date: string, n = 1): CemAct => {
    const first = DECEASED_FIRST[deceased % DECEASED_FIRST.length]!;
    const last = LAST[(deceased * 7 + 3) % LAST.length]!;
    deceased += 1;
    const dob = `${1928 + Math.floor(r() * 55)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}`;
    return {
      k: 'burial',
      date,
      site,
      n,
      name: `${first} ${last}`,
      dob,
      dod: addDays(date, -(3 + Math.floor(r() * 4))),
      undertaker: pick(UNDERTAKERS),
    };
  };
  const sale = (
    site: string,
    date: string,
    holder: string,
    opts: {
      price?: number;
      deposit?: number;
      method?: 'eft' | 'card' | 'cash' | 'bank_transfer';
    } = {},
  ) => {
    const price = opts.price ?? listPrice(site, date);
    const act: CemAct = {
      k: 'sale',
      date,
      site,
      holder,
      price,
      deposit: opts.deposit ?? price,
      method: opts.method ?? 'eft',
      key: saleKey(site, date),
    };
    acts.push(act);
    return act as Extract<CemAct, { k: 'sale' }>;
  };
  /** Monthly instalments after the deposit; stops after `stopAfter` payments when given (arrears). */
  const plan = (
    s: Extract<CemAct, { k: 'sale' }>,
    months: number,
    opts: { stopAfter?: number; startDay?: number } = {},
  ) => {
    let balance = r2(s.price - s.deposit);
    const each = r2(balance / months);
    for (let i = 1; i <= months && balance > 0; i++) {
      if (opts.stopAfter !== undefined && i > opts.stopAfter) break;
      const date = addMonths(s.date, i, opts.startDay ?? Math.min(28, Number(s.date.slice(8))));
      if (date > today) break;
      const amount = i === months ? balance : Math.min(each, balance);
      acts.push({
        k: 'pay',
        date,
        key: s.key,
        amount,
        ref: ref(s.site, i + 1),
        method: i % 4 === 0 ? 'cash' : 'eft',
      });
      balance = r2(balance - amount);
    }
  };

  // ---------------------------------------------------------------- withdrawn and returned sites
  acts.push({
    k: 'withdraw',
    date: '2025-10-01',
    site: 'A-019',
    reason: 'Drainage easement along the eastern path',
  });
  acts.push({
    k: 'withdraw',
    date: '2025-10-01',
    site: 'A-040',
    reason: 'Root zone of the heritage oak tree',
  });
  acts.push({ k: 'withdraw', date: '2025-10-01', site: 'B-012', reason: 'Water main servitude' });
  acts.push({ k: 'withdraw', date: '2025-10-01', site: 'C-040', reason: 'Boundary fence setback' });
  acts.push({
    k: 'withdraw',
    date: '2025-10-15',
    site: 'B-020',
    reason: 'Ground subsidence — awaiting engineer survey',
  });
  acts.push({ k: 'return', date: '2026-02-10', site: 'B-020' });
  acts.push({
    k: 'withdraw',
    date: '2026-05-04',
    site: 'B-031',
    reason: 'Reserved for pathway widening',
  });

  // ---------------------------------------------------------------- opening register (before go-live)
  const openingA = [...Array.from({ length: 18 }, (_, i) => i + 1), 20, 21, 22, 23, 24, 25, 26];
  const historicBurials = new Set([1, 2, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 21]);
  openingA.forEach((n, i) => {
    const site = `A-${String(n).padStart(3, '0')}`;
    const year = 2012 + Math.floor((i / openingA.length) * 13.5);
    const date = `${Math.min(year, 2025)}-${String(1 + ((i * 5) % 9)).padStart(2, '0')}-${String(3 + ((i * 11) % 24)).padStart(2, '0')}`;
    const price =
      Math.round(
        ((n >= 21 && n <= 24 ? 15500 : 9500) + (Number(date.slice(0, 4)) - 2012) * 650) / 50,
      ) * 50;
    const holder = HOLDERS[i]!;
    if (date >= '2025-01-01') {
      const s = sale(site, date, holder, { price, deposit: Math.round(price * 0.4) });
      acts.push({
        k: 'pay',
        date: addDays(date, 45),
        key: s.key,
        amount: r2(price - Math.round(price * 0.4)),
        ref: ref(site, 2),
        method: 'eft',
      });
    } else {
      sale(site, date, holder, { price, deposit: price });
    }
    if (historicBurials.has(n)) {
      const b = addDays(date, 200 + Math.floor(r() * 2400));
      acts.push(burial(site, b < '2025-10-20' ? b : '2025-10-20'));
    }
  });
  const openingB: [number, string, number, number][] = [
    // site, sale date, holder index, deposit (price 14 500 unless noted)
    [1, '2024-02-14', 3, 14500],
    [2, '2024-05-20', 6, 14500],
    [3, '2024-09-09', 9, 14500],
    [4, '2024-09-09', 9, 14500],
    [6, '2025-03-17', 12, 14500],
    [8, '2025-06-23', 15, 14500],
  ];
  for (const [n, date, h, dep] of openingB)
    sale(`B-${String(n).padStart(3, '0')}`, date, HOLDERS[h]!, { price: 14500, deposit: dep });
  // Two opening payment plans that run into the year.
  const b5 = sale('B-005', '2025-08-12', HOLDERS[18]!, { price: 14500, deposit: 4000 });
  plan(b5, 7, { startDay: 12 }); // 1 500 a month: settles in March 2026
  const b7 = sale('B-007', '2025-10-03', HOLDERS[20]!, { price: 14500, deposit: 3000 });
  plan(b7, 10, { startDay: 3 }); // 1 150 a month: settles in August 2026

  // ---------------------------------------------------------------- the year: stories
  // Reserve in January, deposit in February, five instalments, settle in August.
  acts.push({
    k: 'reserve',
    date: '2026-01-12',
    site: 'B-014',
    holder: 'Kavitha Moodley',
    until: '2026-02-28',
    notes: 'Family deciding between B-014 and B-015',
  });
  const moodley = sale('B-014', '2026-02-09', 'Kavitha Moodley', { price: 14500, deposit: 4350 });
  for (let i = 1; i <= 5; i++)
    acts.push({
      k: 'pay',
      date: addMonths('2026-02-09', i),
      key: moodley.key,
      amount: 1500,
      ref: ref('B-014', i + 1),
      method: 'eft',
    });
  acts.push({
    k: 'pay',
    date: '2026-08-14',
    key: moodley.key,
    amount: 2650,
    ref: ref('B-014', 7),
    method: 'eft',
  });
  // Cancellations.
  const pillay = sale('C-005', '2025-12-03', 'Graham Pillai', { price: 11500, deposit: 3000 });
  acts.push({
    k: 'pay',
    date: '2026-01-03',
    key: pillay.key,
    amount: 1500,
    ref: ref('C-005', 2),
    method: 'eft',
  });
  acts.push({
    k: 'pay',
    date: '2026-02-03',
    key: pillay.key,
    amount: 1500,
    ref: ref('C-005', 3),
    method: 'eft',
  });
  acts.push({
    k: 'cancel',
    date: '2026-03-20',
    key: pillay.key,
    reason: 'Family relocating abroad; payments retained under the cemetery rules',
  });
  sale('C-005', '2026-06-11', 'Lindiwe Ndlovu', { method: 'card' });
  const b22 = sale('B-022', '2026-04-08', 'Andries Botha', { price: 14500, deposit: 4000 });
  acts.push({
    k: 'cancel',
    date: '2026-05-15',
    key: b22.key,
    reason: 'Purchaser chose a family plot at another cemetery',
  });
  const c12 = sale('C-012', '2026-07-02', 'Yusuf Ismail', { deposit: 2500 });
  acts.push({
    k: 'cancel',
    date: '2026-09-18',
    key: c12.key,
    reason: 'Duplicate purchase within the family; consolidated on C-013',
  });
  const c13 = sale('C-013', '2026-09-18', 'Yusuf Ismail', { deposit: 2500 });
  plan(c13, 6);
  // Reservations that converted, lapsed, or are still held.
  acts.push({
    k: 'reserve',
    date: '2026-03-02',
    site: 'C-010',
    holder: 'Thabo Mabaso',
    until: '2026-04-15',
    notes: 'Pre-need enquiry',
  });
  plan(sale('C-010', '2026-03-28', 'Thabo Mabaso', { deposit: 3000 }), 6);
  acts.push({
    k: 'reserve',
    date: '2026-06-15',
    site: 'B-019',
    holder: 'Marlene Coetzee',
    until: '2026-07-31',
    notes: 'Awaiting family meeting',
  });
  plan(sale('B-019', '2026-07-10', 'Marlene Coetzee', { deposit: 5000 }), 10);
  acts.push({
    k: 'reserve',
    date: '2025-11-20',
    site: 'A-028',
    holder: 'Sipho Zwane',
    until: '2026-01-31',
    notes: 'Hold for 10 weeks',
  });
  acts.push({ k: 'release', date: '2026-01-31', site: 'A-028' });
  acts.push({
    k: 'reserve',
    date: '2026-02-14',
    site: 'B-037',
    holder: 'Reshma Singh',
    until: '2026-04-30',
    notes: 'Hold pending deposit',
  });
  acts.push({ k: 'release', date: '2026-04-30', site: 'B-037' });
  acts.push({
    k: 'reserve',
    date: '2026-05-03',
    site: 'C-035',
    holder: 'Willem Venter',
    until: '2026-07-31',
    notes: 'Hold pending deposit',
  });
  acts.push({ k: 'release', date: '2026-08-01', site: 'C-035' });
  const stillHeld: [string, string, string][] = [
    ['A-030', '2026-07-06', 'Nomvula Mthethwa'],
    ['A-033', '2026-08-19', 'Rajesh Maharaj'],
    ['B-035', '2026-07-21', 'Carol Daniels'],
    ['B-038', '2026-09-02', 'Mandla Gumede'],
    ['C-024', '2026-08-04', 'Zainab Essop'],
    ['C-027', '2026-09-15', 'Gerrit Kruger'],
    ['C-029', '2026-09-29', 'Palesa Molefe'],
    ['C-031', '2026-10-06', 'Dev Chetty'],
    ['C-033', '2026-10-14', 'Linda Barnard'],
    ['C-034', '2026-10-20', 'Musa Buthelezi'],
  ];
  for (const [site, date, holder] of stillHeld) {
    if (date <= today)
      acts.push({
        k: 'reserve',
        date,
        site,
        holder,
        until: addDays(date, 90),
        notes: 'Held for 90 days',
      });
  }
  // Pre-need rights used this year (burials on sites bought before November 2025).
  acts.push(burial('A-003', '2026-02-17'));
  acts.push(burial('B-002', '2026-04-11'));
  acts.push(burial('A-021', '2026-06-22', 2)); // second interment in a double grave
  acts.push(burial('A-011', '2026-09-03'));

  // ---------------------------------------------------------------- the year: monthly sales
  const perMonth: Record<string, number> = {
    '2025-11': 3,
    '2025-12': 3,
    '2026-01': 5,
    '2026-02': 3,
    '2026-03': 3,
    '2026-04': 3,
    '2026-05': 4,
    '2026-06': 2,
    '2026-07': 3,
    '2026-08': 3,
    '2026-09': 3,
    '2026-10': 3,
  };
  const reservedOrStory = new Set([
    'B-012',
    'B-014',
    'B-019',
    'B-020',
    'B-022',
    'B-031',
    'B-035',
    'B-037',
    'B-038',
    'C-005',
    'C-010',
    'C-012',
    'C-013',
    'C-024',
    'C-027',
    'C-029',
    'C-031',
    'C-033',
    'C-034',
    'C-035',
    'C-040',
  ]);
  const pool = [
    ...Array.from({ length: 40 }, (_, i) => `B-${String(i + 1).padStart(3, '0')}`).filter(
      (s) => Number(s.slice(2)) >= 9,
    ),
    ...Array.from({ length: 39 }, (_, i) => `C-${String(i + 1).padStart(3, '0')}`),
  ].filter((s) => !reservedOrStory.has(s));
  let next = 0;
  let generic = 0;
  let holderIdx = 26;
  for (const month of Object.keys(perMonth)) {
    for (let j = 0; j < perMonth[month]!; j++) {
      const day = 3 + Math.floor(((j + 1) / (perMonth[month]! + 1)) * 24);
      const date = `${month}-${String(day).padStart(2, '0')}`;
      if (date > today) continue;
      const site = pool[next++]!;
      const holder = HOLDERS[holderIdx % HOLDERS.length]!;
      holderIdx += generic % 6 === 5 ? 0 : 1; // now and then one family takes two adjacent graves
      generic += 1;
      const atNeed = generic % 4 === 2;
      const kind = atNeed
        ? 'cash'
        : pick(['cash', 'plan3', 'plan6', 'plan6', 'plan10', 'plan10'] as const);
      const price = listPrice(site, date);
      if (kind === 'cash') {
        sale(site, date, holder, { method: pick(['eft', 'card', 'bank_transfer'] as const) });
      } else {
        const months = kind === 'plan3' ? 3 : kind === 'plan6' ? 6 : 10;
        const s = sale(site, date, holder, {
          deposit: Math.round((price * (0.2 + r() * 0.2)) / 50) * 50,
        });
        plan(s, months, generic % 7 === 3 ? { stopAfter: 2 } : {}); // a few stop paying: arrears
      }
      if (atNeed) {
        const b = addDays(date, 4);
        if (b <= today) acts.push(burial(site, b));
      }
    }
  }

  const sorted = acts
    .filter((a) => a.date <= today)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.date.localeCompare(y.a.date) || ORDER[x.a.k] - ORDER[y.a.k] || x.i - y.i)
    .map((x) => x.a);
  return {
    acts: sorted,
    doubleSites: ['A-021', 'A-022', 'A-023', 'A-024'],
    cremationSites: ['C-036', 'C-037', 'C-038', 'C-039'],
  };
}
