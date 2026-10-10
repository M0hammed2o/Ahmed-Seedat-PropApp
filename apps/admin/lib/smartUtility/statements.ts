import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { writeAuditEvent } from '../audit';
import { dispatchEmail } from '../emailDispatch';
import { loadHybridDashboard } from './hybridDashboard';

// Monthly utility statements (docs/HYBRID_UTILITIES_ARCHITECTURE.md §F). A statement is an immutable snapshot:
// generated as a draft → reviewed and approved by staff → only then visible to the tenant (RLS) or downloadable /
// sendable. Sending to tenants is behind SMART_UTILITY_TENANT_STATEMENTS_ENABLED (default off) AND a staff click;
// nothing is distributed automatically.

export class StatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementError';
  }
}

export function tenantStatementsEnabled(): boolean {
  return process.env.SMART_UTILITY_TENANT_STATEMENTS_ENABLED === 'true';
}

const UNIT = { water: 'kL', electricity: 'kWh' } as const;
const rand = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `R ${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-ZA', { maximumFractionDigits: 3 }));
const lastDay = (endExclusive: string) => new Date(Date.parse(`${endExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

interface ChargeRow {
  id: string;
  lease_id: string | null;
  tenant_id: string | null;
  unit_id: string | null;
  utility_type: 'water' | 'electricity';
  charge_type: string;
  status: string;
  segment_start: string | null;
  segment_end: string | null;
  period_start: string;
  period_end: string;
  opening_reading: number | null;
  closing_reading: number | null;
  consumption: number | null;
  consumption_quality: string;
  amount_excl_vat: number | null;
  vat_amount: number | null;
  total_amount: number;
  adjustment_total: number;
  credit_applied: number;
  allocation_share: number | null;
  tariff_snapshot: { name?: string } | null;
  calculation: { lines?: { label: string; quantity: number | null; unit: string | null; rate: number | null; inclCents: number }[]; method?: string; group?: string } | null;
  review_flags: string[];
  dispute_status: string;
  invoice_id: string | null;
  units: { unit_label: string } | null;
}

export interface TenantStatementSnapshot {
  kind: 'tenant';
  org: { name: string; vatNo: string | null; contact: string | null };
  property: { name: string; address: string | null };
  unitLabel: string | null;
  tenantName: string | null;
  period: { start: string; end: string };
  lines: {
    utility: 'water' | 'electricity';
    description: string;
    segment: string;
    opening: number | null;
    closing: number | null;
    consumption: number | null;
    unit: string;
    basis: 'actual' | 'estimated';
    tariff: string | null;
    breakdown: { label: string; amount: number }[];
    excl: number | null;
    vat: number | null;
    adjustments: number;
    creditApplied: number;
    total: number;
    status: string;
  }[];
  totals: { excl: number | null; vat: number | null; total: number };
  notes: string[];
  generatedAt: string;
}

function describeCharge(c: ChargeRow): string {
  const label = c.utility_type === 'water' ? 'Water' : 'Electricity';
  if (c.charge_type === 'allocation') return `${label} — share of ${c.calculation?.group ?? 'shared meter'} (${c.calculation?.method?.replace('_', ' ') ?? 'allocation'})`;
  if (c.charge_type === 'allowance_fee') return `${label} — fixed monthly amount`;
  if (c.charge_type === 'excess') return `${label} — usage above allowance`;
  return `${label} — metered usage`;
}

/** Drafts one tenant statement per lease with APPROVED or INVOICED charges in the period (drafts are excluded). */
export async function generateStatements(
  serviceClient: SupabaseClient,
  args: { propertyId: string; periodStart: string; periodEnd: string; audience: 'tenant' | 'owner'; actorUserId: string },
) {
  if (args.periodEnd <= args.periodStart) throw new StatementError('The period end must be after its start.');
  const { data: property } = await serviceClient.from('properties').select('id, org_id, nickname, address_line1, city').eq('id', args.propertyId).single();
  if (!property) throw new StatementError('Property not found.');
  const { data: org } = await serviceClient
    .from('organizations')
    .select('legal_name, trading_name, vat_no, support_email, support_phone')
    .eq('id', property.org_id)
    .single();
  const orgInfo = {
    name: (org?.trading_name || org?.legal_name || 'Landlord') as string,
    vatNo: (org?.vat_no as string | null) ?? null,
    contact: [org?.support_phone, org?.support_email].filter(Boolean).join(' · ') || null,
  };
  const propertyInfo = { name: property.nickname || property.address_line1 || 'Property', address: [property.address_line1, property.city].filter(Boolean).join(', ') || null };
  const created: string[] = [];
  let existing = 0;
  const insert = async (row: Record<string, unknown>) => {
    const { data, error } = await serviceClient.from('utility_statements').insert(row).select('id').single();
    if (error) {
      if (error.code === '23505') {
        existing += 1;
        return;
      }
      throw new Error(`statement insert failed: ${error.message}`);
    }
    created.push(data.id as string);
  };

  if (args.audience === 'owner') {
    const dashboard = await loadHybridDashboard(serviceClient, args.propertyId, { from: args.periodStart, to: args.periodEnd });
    await insert({
      org_id: property.org_id,
      property_id: property.id,
      audience: 'owner',
      period_start: args.periodStart,
      period_end: args.periodEnd,
      snapshot: { kind: 'owner', org: orgInfo, property: propertyInfo, period: { start: args.periodStart, end: lastDay(args.periodEnd) }, dashboard, generatedAt: new Date().toISOString() },
      created_by: args.actorUserId,
    });
  } else {
    const { data: rows, error } = await serviceClient
      .from('utility_charges')
      .select(
        'id, lease_id, tenant_id, unit_id, utility_type, charge_type, status, segment_start, segment_end, period_start, period_end, opening_reading, closing_reading, consumption, consumption_quality, amount_excl_vat, vat_amount, total_amount, adjustment_total, credit_applied, allocation_share, tariff_snapshot, calculation, review_flags, dispute_status, invoice_id, units(unit_label)',
      )
      .eq('property_id', args.propertyId)
      .in('status', ['approved', 'invoiced'])
      .gte('period_start', args.periodStart)
      .lt('period_start', args.periodEnd)
      .not('lease_id', 'is', null);
    if (error) throw new Error(error.message);
    const byLease = new Map<string, ChargeRow[]>();
    for (const c of (rows ?? []) as unknown as ChargeRow[]) byLease.set(c.lease_id!, [...(byLease.get(c.lease_id!) ?? []), c]);
    if (byLease.size === 0) throw new StatementError('No approved or invoiced charges in this period: approve charges before preparing tenant statements.');
    const tenantIds = [...new Set([...byLease.values()].flat().map((c) => c.tenant_id).filter((t): t is string => !!t))];
    const { data: tenants } = await serviceClient.from('tenants').select('id, full_name').in('id', tenantIds.length ? tenantIds : ['00000000-0000-0000-0000-000000000000']);
    const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.full_name as string]));
    for (const [leaseId, charges] of byLease) {
      const lines: TenantStatementSnapshot['lines'] = charges
        .sort((a, b) => a.utility_type.localeCompare(b.utility_type) || String(a.segment_start).localeCompare(String(b.segment_start)))
        .map((c) => ({
          utility: c.utility_type,
          description: describeCharge(c),
          segment: `${c.segment_start ?? c.period_start} to ${lastDay(c.segment_end ?? c.period_end)}`,
          opening: c.opening_reading === null ? null : Number(c.opening_reading),
          closing: c.closing_reading === null ? null : Number(c.closing_reading),
          consumption: c.consumption === null ? null : Number(c.consumption),
          unit: UNIT[c.utility_type],
          basis: c.consumption_quality === 'complete' ? 'actual' : 'estimated',
          tariff: c.tariff_snapshot?.name ?? null,
          breakdown: (c.calculation?.lines ?? []).map((l) => ({
            label: `${l.label}${l.quantity !== null && l.rate !== null ? ` (${qty(l.quantity)} ${l.unit ?? ''} × R${l.rate})` : ''}`,
            amount: l.inclCents / 100,
          })),
          excl: c.amount_excl_vat === null ? null : Number(c.amount_excl_vat),
          vat: c.vat_amount === null ? null : Number(c.vat_amount),
          adjustments: Number(c.adjustment_total),
          creditApplied: Number(c.credit_applied),
          total: Number(c.total_amount),
          status: c.status,
        }));
      const sum = (f: (l: (typeof lines)[number]) => number | null) =>
        lines.every((l) => f(l) !== null) ? Math.round(lines.reduce((a, l) => a + (f(l) ?? 0), 0) * 100) / 100 : null;
      const notes = [
        'Amounts include VAT where the tariff includes VAT.',
        ...(lines.some((l) => l.basis === 'estimated') ? ['Lines marked "estimated" were calculated from incomplete readings.'] : []),
        ...(charges.some((c) => c.dispute_status === 'resolved') ? ['A query on one of these charges was resolved before this statement was prepared.'] : []),
      ];
      const snapshot: TenantStatementSnapshot = {
        kind: 'tenant',
        org: orgInfo,
        property: propertyInfo,
        unitLabel: charges[0]!.units?.unit_label ?? null,
        tenantName: charges[0]!.tenant_id ? (tenantName.get(charges[0]!.tenant_id) ?? null) : null,
        period: { start: args.periodStart, end: lastDay(args.periodEnd) },
        lines,
        totals: { excl: sum((l) => l.excl), vat: sum((l) => l.vat), total: Math.round(lines.reduce((a, l) => a + l.total, 0) * 100) / 100 },
        notes,
        generatedAt: new Date().toISOString(),
      };
      await insert({
        org_id: property.org_id,
        property_id: property.id,
        audience: 'tenant',
        lease_id: leaseId,
        tenant_id: charges[0]!.tenant_id,
        period_start: args.periodStart,
        period_end: args.periodEnd,
        snapshot,
        created_by: args.actorUserId,
      });
    }
  }
  return { created: created.length, existing, statementIds: created };
}

export async function statementAction(
  serviceClient: SupabaseClient,
  args: { statementId: string; propertyId: string; action: 'approve' | 'void' | 'send'; actorUserId: string },
) {
  const { data: s } = await serviceClient
    .from('utility_statements')
    .select('id, org_id, property_id, audience, status, lease_id, tenant_id, period_start, period_end, snapshot')
    .eq('id', args.statementId)
    .eq('property_id', args.propertyId)
    .single();
  if (!s) throw new StatementError('Statement not found.');
  const now = new Date().toISOString();
  if (args.action === 'approve') {
    if (s.status !== 'draft') throw new StatementError('Only draft statements can be approved.');
    await serviceClient.from('utility_statements').update({ status: 'approved', approved_by: args.actorUserId, approved_at: now }).eq('id', s.id).eq('status', 'draft');
  } else if (args.action === 'void') {
    if (s.status === 'void') throw new StatementError('Already void.');
    await serviceClient.from('utility_statements').update({ status: 'void' }).eq('id', s.id);
  } else {
    if (s.audience !== 'tenant') throw new StatementError('Owner statements are downloaded, not emailed.');
    if (s.status !== 'approved') throw new StatementError('Approve the statement before sending it.');
    if (!tenantStatementsEnabled()) {
      throw new StatementError('Sending statements to tenants is switched off (SMART_UTILITY_TENANT_STATEMENTS_ENABLED). Download the PDF instead.');
    }
    const { data: tenant } = await serviceClient.from('tenants').select('email, user_id').eq('id', s.tenant_id).maybeSingle();
    if (!tenant?.email) throw new StatementError('The tenant has no email address.');
    const snapshot = s.snapshot as TenantStatementSnapshot;
    const pdf = await renderStatementPdf(snapshot);
    const result = await dispatchEmail(serviceClient, {
      orgId: s.org_id,
      toAddress: tenant.email,
      toUserId: tenant.user_id,
      templateName: 'utility_statement_ready',
      templateVars: {
        period: `${snapshot.period.start} to ${snapshot.period.end}`,
        propertyLabel: [snapshot.unitLabel, snapshot.property.name].filter(Boolean).join(', '),
        totalLabel: rand(snapshot.totals.total),
        orgName: snapshot.org.name,
      },
      relatedEntityType: 'utility_statements',
      relatedEntityId: s.id,
      actorUserId: args.actorUserId,
      files: [{ filename: `utility-statement-${snapshot.period.start}.pdf`, contentBase64: pdf.toString('base64'), contentType: 'application/pdf' }],
    });
    if (!result.sent && result.reason !== 'already_sent') throw new StatementError(`Not sent (${result.reason}).`);
    await serviceClient.from('utility_statements').update({ status: 'sent', sent_at: now, sent_to: tenant.email }).eq('id', s.id);
    await writeAuditEvent(serviceClient, { orgId: s.org_id, actorUserId: args.actorUserId, actorType: 'user', action: 'utility_statement.sent', entityType: 'utility_statements', entityId: s.id, after: { deliveryConfigured: result.deliveryConfigured } });
    return { status: 'sent', deliveryConfigured: result.deliveryConfigured };
  }
  await writeAuditEvent(serviceClient, {
    orgId: s.org_id,
    actorUserId: args.actorUserId,
    actorType: 'user',
    action: `utility_statement.${args.action === 'approve' ? 'approved' : 'voided'}`,
    entityType: 'utility_statements',
    entityId: s.id,
    after: null,
  });
  return { status: args.action === 'approve' ? 'approved' : 'void' };
}

// ---------------------------------------------------------------- PDF

interface OwnerSnapshot {
  kind: 'owner';
  org: TenantStatementSnapshot['org'];
  property: TenantStatementSnapshot['property'];
  period: { start: string; end: string };
  dashboard: Awaited<ReturnType<typeof loadHybridDashboard>>;
}

export function renderStatementPdf(snapshot: TenantStatementSnapshot | OwnerSnapshot, opts: { draft?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const ensure = (h: number) => {
      if (doc.y + h > 780) doc.addPage();
    };
    doc.font('Helvetica-Bold').fontSize(16).text(snapshot.org.name);
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    if (snapshot.org.vatNo) doc.text(`VAT no: ${snapshot.org.vatNo}`);
    if (snapshot.org.contact) doc.text(snapshot.org.contact);
    doc.moveDown();
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(13).text(snapshot.kind === 'tenant' ? 'Utility statement' : 'Owner utility report');
    if (opts.draft) doc.fillColor('#b45309').fontSize(10).text('DRAFT — not yet approved').fillColor('#000000');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Property: ${snapshot.property.name}${snapshot.property.address ? ` (${snapshot.property.address})` : ''}`);
    if (snapshot.kind === 'tenant') {
      if (snapshot.unitLabel) doc.text(`Unit: ${snapshot.unitLabel}`);
      if (snapshot.tenantName) doc.text(`Tenant: ${snapshot.tenantName}`);
    }
    doc.text(`Period: ${snapshot.period.start} to ${snapshot.period.end}`);
    doc.moveDown();

    if (snapshot.kind === 'tenant') {
      for (const l of snapshot.lines) {
        ensure(110);
        doc.font('Helvetica-Bold').fontSize(10).text(`${l.description}  ·  ${l.segment}`);
        doc.font('Helvetica').fontSize(9);
        if (l.opening !== null || l.closing !== null) doc.text(`Readings: ${qty(l.opening)} → ${qty(l.closing)} ${l.unit}`);
        doc.text(`Consumption: ${qty(l.consumption)} ${l.unit} (${l.basis})${l.tariff ? `  ·  Tariff: ${l.tariff}` : ''}`);
        for (const b of l.breakdown) doc.text(`   ${b.label}: ${rand(b.amount)}`);
        if (l.adjustments) doc.text(`   Adjustment: ${rand(l.adjustments)}`);
        if (l.creditApplied) doc.text(`   Credit applied: −${rand(l.creditApplied)}`);
        doc.text(`Excl. VAT ${rand(l.excl)}   VAT ${rand(l.vat)}   Total ${rand(l.total)}`);
        doc.moveDown(0.6);
      }
      ensure(60);
      doc.font('Helvetica-Bold').fontSize(11).text(`Total for the period: ${rand(snapshot.totals.total)}`);
      doc.font('Helvetica').fontSize(9).text(`Excl. VAT ${rand(snapshot.totals.excl)}   VAT ${rand(snapshot.totals.vat)}`);
      doc.moveDown();
      for (const n of snapshot.notes) doc.fillColor('#555555').text(n);
    } else {
      const d = snapshot.dashboard;
      const fig = (f: { value: number | null; basis: string }, unit: string) => (f.value === null ? `— (${f.basis})` : `${qty(f.value)} ${unit} (${f.basis})`);
      doc.font('Helvetica-Bold').fontSize(11).text('Electricity');
      doc.font('Helvetica').fontSize(9);
      doc.text(`Grid import ${fig(d.electricity.gridImport, 'kWh')}  ·  Export ${fig(d.electricity.gridExport, 'kWh')}`);
      doc.text(`Solar generation ${fig(d.electricity.generation, 'kWh')}  ·  Solar self-use ${fig(d.electricity.solarSelfConsumption, 'kWh')}`);
      doc.text(`Generator ${fig(d.electricity.generatorOutput, 'kWh')}  ·  Site supply ${fig(d.electricity.siteSupply, 'kWh')}`);
      doc.text(`Measured consumption ${fig(d.electricity.measuredConsumption, 'kWh')}  ·  Variance ${fig(d.electricity.variance, 'kWh')}`);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).text('Water');
      doc.font('Helvetica').fontSize(9);
      for (const s of d.water.bySource) doc.text(`${s.label}: ${fig(s.volume, 'kL')}`);
      doc.text(`Total supply ${fig(d.water.totalSupply, 'kL')}  ·  Storage change ${fig(d.water.storageChange, 'kL')}  ·  Site use ${fig(d.water.siteUse, 'kL')}`);
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).text('Recovery');
      doc.font('Helvetica').fontSize(9);
      for (const r of d.recovery) {
        doc.text(
          `${r.utilityType}: recharged (approved + invoiced) ${rand(r.charges.approved + r.charges.invoiced)} · estimated supply cost ${rand(r.estimatedSupplyCost)}${r.recoveryPct !== null ? ` · ${r.recoveryPct}%` : ''}`,
        );
      }
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(11).text('Units');
      doc.font('Helvetica').fontSize(9);
      for (const u of d.units) {
        ensure(14);
        doc.text(
          `${u.unitLabel}: water ${u.water ? `${qty(u.water.consumption)} kL, charged ${rand(u.water.charged)}` : '—'}; electricity ${u.electricity ? `${qty(u.electricity.consumption)} kWh, charged ${rand(u.electricity.charged)}` : '—'}`,
        );
      }
      doc.moveDown();
      for (const n of d.notes) doc.fillColor('#555555').text(n);
    }
    doc.end();
  });
}
