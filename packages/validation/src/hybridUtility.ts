import { z } from 'zod';

// Hybrid utilities (migration 178, docs/HYBRID_UTILITIES_ARCHITECTURE.md).

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const ELECTRICITY_SOURCE_TYPES = ['municipal_grid', 'eskom_direct', 'prepaid', 'solar_pv', 'battery', 'generator', 'other'] as const;
export const WATER_SOURCE_TYPES = ['municipal', 'borehole', 'rainwater', 'storage_tank', 'tanker', 'other'] as const;

export const supplySourceCreateSchema = z
  .object({
    utilityType: z.enum(['water', 'electricity']),
    sourceType: z.enum([...ELECTRICITY_SOURCE_TYPES, ...WATER_SOURCE_TYPES]),
    name: z.string().trim().min(1).max(100),
    buildingId: uuid.optional().nullable(),
    unitId: uuid.optional().nullable(),
    capacityValue: z.number().min(0).max(1e9).optional().nullable(),
    capacityUnit: z.enum(['kWp', 'kWh', 'kVA', 'kW', 'litres', 'kL_per_hour']).optional().nullable(),
    fuelType: z.enum(['diesel', 'petrol', 'gas', 'other']).optional().nullable(),
    billingGrade: z.boolean().default(false),
    integrationId: uuid.optional().nullable(),
    externalDeviceId: optionalText(100),
    externalChannel: z.string().trim().max(40).optional().default(''),
    levelMetric: z.enum(['tank_level_litres', 'tank_level_pct', 'battery_soc_pct', 'fuel_level_pct']).optional().nullable(),
    lowLevelPct: z.number().min(0).max(100).default(20),
    highLevelPct: z.number().min(0).max(100).default(98),
    expectedDailyRunHours: z.number().min(0).max(24).optional().nullable(),
    commissionedOn: isoDate.optional().nullable(),
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    const list: readonly string[] = v.utilityType === 'electricity' ? ELECTRICITY_SOURCE_TYPES : WATER_SOURCE_TYPES;
    if (!list.includes(v.sourceType)) ctx.addIssue({ code: 'custom', path: ['sourceType'], message: `Not a ${v.utilityType} source type.` });
  });

export const supplySourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
  lowLevelPct: z.number().min(0).max(100).optional(),
  highLevelPct: z.number().min(0).max(100).optional(),
  expectedDailyRunHours: z.number().min(0).max(24).optional().nullable(),
  capacityValue: z.number().min(0).max(1e9).optional().nullable(),
  notes: optionalText(500),
});

export const sourceReadingSchema = z.object({
  metric: z.enum(['tank_level_litres', 'tank_level_pct', 'battery_soc_pct', 'fuel_level_pct', 'run_hours']),
  readAt: z.string().datetime({ offset: true }),
  value: z.number().min(0).max(1e9),
});

export const sourceLogSchema = z.object({
  logType: z.enum(['fuel_purchase', 'fuel_added', 'tanker_delivery', 'maintenance', 'run_hours', 'service', 'other']),
  occurredAt: z.string().datetime({ offset: true }),
  quantity: z.number().min(0).max(1e9).optional().nullable(),
  quantityUnit: z.enum(['litres', 'kL', 'hours', 'kWh']).optional().nullable(),
  costAmount: z.number().min(0).max(1e9).optional().nullable(),
  costVatInclusive: z.boolean().default(true),
  documentId: uuid.optional().nullable(),
  notes: optionalText(500),
});

const blockV2 = z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0).max(100_000) });
const touPeriodSchema = z.object({
  name: z.string().trim().min(1).max(40),
  rate: z.number().min(0).max(100_000),
  windows: z
    .array(
      z.object({
        days: z.enum(['weekday', 'saturday', 'sunday', 'all']),
        from: z.string().regex(/^\d{2}:\d{2}$/),
        to: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .min(1)
    .max(12),
});
const seasonSchema = z.object({
  name: z.string().trim().min(1).max(40),
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12),
  blocks: z.array(blockV2).max(10).optional(),
  touPeriods: z.array(touPeriodSchema).max(6).optional(),
});

export const utilityTariffV2Schema = z.object({
  utilityType: z.enum(['water', 'electricity']),
  name: z.string().trim().min(1).max(100),
  tariffKind: z.enum(['block', 'tou', 'flat', 'fixed_only', 'cost_recovery', 'prepaid_passthrough']).default('block'),
  fixedCharge: z.number().min(0).max(1_000_000).default(0),
  blocks: z.array(blockV2).max(10).default([]),
  touPeriods: z.array(touPeriodSchema).max(6).default([]),
  seasons: z.array(seasonSchema).max(4).default([]),
  vatInclusive: z.boolean().default(true),
  vatRate: z.number().min(0).max(100).default(15),
  prorateBlocks: z.boolean().default(true),
  unitId: uuid.optional().nullable(),
  supplySourceType: z.string().max(40).optional().nullable(),
  customerClass: optionalText(100),
  municipalityCode: z.string().regex(/^[a-z0-9_]{2,40}$/).optional().nullable(),
  sourceReference: optionalText(300),
  effectiveFrom: isoDate,
  notes: optionalText(500),
});
export type UtilityTariffV2Input = z.infer<typeof utilityTariffV2Schema>;

export const tariffPreviewSchema = z.object({
  tariffId: uuid.optional(),
  tariff: utilityTariffV2Schema.optional(),
  meterId: uuid.optional(),
  consumption: z.number().min(0).max(1e9).optional(),
  periodStart: isoDate,
  periodEnd: isoDate,
  segmentStart: isoDate.optional(),
  segmentEnd: isoDate.optional(),
  allowanceQuantity: z.number().min(0).max(1e9).optional().nullable(),
});

export const tariffImportSchema = z.object({
  csv: z.string().min(1).max(200_000),
  dryRun: z.boolean().default(true),
});

export const billingArrangementSchema = z
  .object({
    unitId: uuid,
    utilityType: z.enum(['water', 'electricity']),
    arrangement: z.enum(['metered_recharge', 'shared_allocation', 'landlord_paid', 'included_in_rent', 'fixed_allowance', 'tenant_direct']),
    invoiceMode: z.enum(['separate_invoice', 'with_draft_invoice']).default('separate_invoice'),
    allocationGroupId: uuid.optional().nullable(),
    fixedAmount: z.number().min(0).max(1_000_000).optional().nullable(),
    allowanceQuantity: z.number().min(0).max(1e9).optional().nullable(),
    effectiveFrom: isoDate,
    contractReference: optionalText(200),
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.arrangement === 'shared_allocation' && !v.allocationGroupId) {
      ctx.addIssue({ code: 'custom', path: ['allocationGroupId'], message: 'Choose the shared meter group.' });
    }
    if (v.arrangement === 'fixed_allowance' && (v.fixedAmount === null || v.fixedAmount === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Enter the fixed monthly amount.' });
    }
  });

export const allocationGroupSchema = z
  .object({
    meterId: uuid,
    name: z.string().trim().min(1).max(100),
    method: z.enum(['equal', 'floor_area', 'occupancy', 'percentage']),
    landlordSharePct: z.number().min(0).max(100).default(0),
    members: z
      .array(
        z.object({
          unitId: uuid,
          percentage: z.number().min(0).max(100).optional().nullable(),
          occupants: z.number().int().min(0).max(100).optional().nullable(),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.members.map((m) => m.unitId)).size !== v.members.length) {
      ctx.addIssue({ code: 'custom', path: ['members'], message: 'A unit appears twice.' });
    }
    if (v.method === 'percentage') {
      const total = v.members.reduce((a, m) => a + (m.percentage ?? 0), 0) + v.landlordSharePct;
      if (Math.abs(total - 100) > 0.0001) {
        ctx.addIssue({ code: 'custom', path: ['members'], message: `Percentages plus the landlord share must total 100 (now ${total}).` });
      }
    }
    if (v.method === 'occupancy' && v.members.some((m) => m.occupants === null || m.occupants === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['members'], message: 'Enter the number of occupants for every unit.' });
    }
  });

export const chargeAdjustmentSchema = z.object({
  chargeId: uuid,
  amount: z.number().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(3).max(500),
});

export const chargeDisputeSchema = z.object({
  chargeId: uuid,
  action: z.enum(['open', 'resolve']),
  text: z.string().trim().min(3).max(1000),
});

export const utilityCreditSchema = z.object({
  chargeId: uuid,
  amount: z.number().positive().max(1_000_000),
  reason: z.string().trim().min(3).max(500),
});

export const statementGenerateSchema = z.object({
  periodStart: isoDate,
  periodEnd: isoDate,
  audience: z.enum(['tenant', 'owner']),
});

export const statementActionSchema = z.object({ action: z.enum(['approve', 'void', 'send']) });
