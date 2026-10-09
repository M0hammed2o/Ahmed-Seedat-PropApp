import { z } from 'zod';

// Smart Utility Monitoring (docs/SMART_UTILITY_ARCHITECTURE.md §11, migration 20260101000175).

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const smartMeterCreateSchema = z.object({
  utilityType: z.enum(['water', 'electricity']),
  unitId: z.string().uuid().optional().nullable(),
  buildingId: z.string().uuid().optional().nullable(),
  meterRole: z.enum(['main', 'submeter', 'check']),
  ownership: z.enum(['municipal', 'private']),
  parentMeterId: z.string().uuid().optional().nullable(),
  meterNumber: optionalText(100),
  location: optionalText(200),
  manufacturer: optionalText(100),
  model: optionalText(100),
  serialNumber: optionalText(100),
  connectivity: z.enum(['manual', 'lorawan', 'wifi', 'modbus_gateway', 'http_push', 'simulator']),
  integrationId: z.string().uuid().optional().nullable(),
  externalDeviceId: optionalText(100),
  externalChannel: z.string().trim().max(40).optional().default(''),
  multiplier: z.number().positive().max(1_000_000).default(1),
  /** In base units (L / kWh): the dial reading when the pulse counter was fitted at zero. */
  valueOffset: z.number().min(0).max(1e12).default(0),
  registerDigits: z.number().int().min(3).max(12).optional().nullable(),
  expectedIntervalMinutes: z.union([z.literal(15), z.literal(60), z.literal(1440), z.literal(43200)]).optional().nullable(),
  tariffPerUnit: z.number().min(0).max(100_000).optional().nullable(),
  municipalAccountNumber: optionalText(60),
  responsibilityMode: z
    .enum(['owner_paid', 'tenant_paid_direct', 'tenant_prepaid', 'included_in_rent', 'common_area_owner'])
    .default('owner_paid'),
  isPrepaid: z.boolean().default(false),
  installedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: optionalText(500),
}).superRefine((v, ctx) => {
  if (v.meterRole === 'submeter' && !v.unitId && !v.buildingId) {
    ctx.addIssue({ code: 'custom', path: ['unitId'], message: 'A submeter must belong to a unit or building.' });
  }
  if (v.connectivity !== 'manual' && (!v.integrationId || !v.externalDeviceId)) {
    ctx.addIssue({
      code: 'custom',
      path: ['externalDeviceId'],
      message: 'Connected meters need an integration and the device ID (e.g. LoRaWAN DevEUI or Shelly device id).',
    });
  }
});
export type SmartMeterCreateInput = z.infer<typeof smartMeterCreateSchema>;

export const smartMeterUpdateSchema = z.object({
  meterNumber: optionalText(100),
  location: optionalText(200),
  installedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  serialNumber: optionalText(100),
  manufacturer: optionalText(100),
  model: optionalText(100),
  ownership: z.enum(['municipal', 'private']).optional(),
  parentMeterId: z.string().uuid().optional().nullable(),
  buildingId: z.string().uuid().optional().nullable(),
  multiplier: z.number().positive().max(1_000_000).optional(),
  valueOffset: z.number().min(0).max(1e12).optional(),
  registerDigits: z.number().int().min(3).max(12).optional().nullable(),
  expectedIntervalMinutes: z.union([z.literal(15), z.literal(60), z.literal(1440), z.literal(43200)]).optional().nullable(),
  tariffPerUnit: z.number().min(0).max(100_000).optional().nullable(),
  municipalAccountNumber: optionalText(60),
  notes: optionalText(500),
  decommission: z.boolean().optional(),
});
export type SmartMeterUpdateInput = z.infer<typeof smartMeterUpdateSchema>;

export const manualMeterReadingSchema = z.object({
  readAt: z.string().datetime({ offset: true }),
  /** In the meter's display unit: kL for water, kWh for electricity. */
  reading: z.number().min(0).max(1e12),
  documentId: z.string().uuid().optional().nullable(),
  notes: optionalText(500),
});
export type ManualMeterReadingInput = z.infer<typeof manualMeterReadingSchema>;

const PROVIDER_IDS = [
  'milesight_lorawan',
  'shelly_gen2',
  'generic_json',
  'simulator',
  'chirpstack_v4',
  'tts_v3',
  'thingsboard',
] as const;

const credentialsSchema = z
  .record(z.string().regex(/^[a-zA-Z]{1,30}$/), z.string().max(2000))
  .refine((v) => Object.keys(v).length <= 10, 'Too many credential fields.');

export const meterIntegrationCreateSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  name: z.string().trim().min(1).max(100),
  /** Non-secret provider settings, e.g. {baseUrl} for ThingsBoard. */
  config: z.record(z.string().regex(/^[a-zA-Z]{1,30}$/), z.string().max(500)).optional().default({}),
  /** Secret values; encrypted server-side and never returned. */
  credentials: credentialsSchema.optional(),
  syncIntervalMinutes: z.union([z.literal(15), z.literal(60), z.literal(1440)]).optional(),
});

export const meterIntegrationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rotate') }),
  z.object({ action: z.literal('revoke') }),
  z.object({ action: z.literal('verify') }),
  z.object({ action: z.literal('sync_now') }),
  z.object({ action: z.literal('update_credentials'), credentials: credentialsSchema }),
]);

export const meterIntegrationRequestSchema = z.object({
  propertyId: z.string().uuid().optional().nullable(),
  utilityType: z.enum(['water', 'electricity']),
  manufacturer: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  connectionMethod: z.string().trim().max(100).optional().nullable(),
  supplier: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const buildingCreateSchema = z.object({ name: z.string().trim().min(1).max(100) });

export const municipalSubmissionSettingsSchema = z.object({
  municipalityCode: z.string().regex(/^[a-z0-9_]{2,40}$/).optional().nullable(),
  municipalAccountNumber: optionalText(60),
  mode: z.enum(['manual', 'approval_required', 'automatic']),
  billingDay: z.number().int().min(1).max(28),
  leadDays: z.number().int().min(0).max(20),
  includePhotos: z.boolean(),
  enabled: z.boolean(),
});
export type MunicipalSubmissionSettingsInput = z.infer<typeof municipalSubmissionSettingsSchema>;

export const submissionRecipientCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  label: optionalText(100),
  recipientType: z.enum(['municipality', 'managing_agent', 'utility_company', 'accountant', 'custom']),
  /** The owner's explicit authorisation to send reading packs (incl. account number) to this address. */
  authorise: z.boolean(),
});

export const submissionRecipientUpdateSchema = z.object({
  active: z.boolean().optional(),
  authorise: z.boolean().optional(),
  label: optionalText(100),
});

export const submissionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('send') }),
  z.object({ action: z.literal('cancel') }),
  z.object({
    action: z.literal('acceptance'),
    acceptanceStatus: z.enum(['unknown', 'accepted', 'rejected', 'not_applicable']),
    reference: optionalText(100),
    notes: optionalText(1000),
  }),
]);

export const submissionGenerateSchema = z.object({
  /** YYYY-MM-DD; defaults to the last complete billing period. */
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const utilityAlertUpdateSchema = z.object({ status: z.enum(['acknowledged', 'resolved', 'open']) });

export const utilityAlertSettingsSchema = z.object({
  discrepancyThresholdPct: z.number().min(0).max(100),
  spikeMultiple: z.number().min(1).max(50),
  nightFlowLitresPerHour: z.number().min(0).max(10_000),
  nightBaseLoadRatio: z.number().min(0).max(5),
  vacantWaterLitresPerDay: z.number().min(0).max(100_000),
  vacantElectricityKwhPerDay: z.number().min(0).max(10_000),
});
