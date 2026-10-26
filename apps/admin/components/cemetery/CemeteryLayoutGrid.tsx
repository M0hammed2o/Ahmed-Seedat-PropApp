'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, X, Cross } from 'lucide-react';
import type { RegisterSite } from '@/lib/cemetery/data';
import {
  BURIAL_STATUS_LABEL,
  SALE_STATUSES,
  SALE_STATUS_LABEL,
  SALE_STATUS_SWATCH,
  SALE_STATUS_TILE,
  formatDate,
  formatZar,
  type GraveSaleStatus,
  type TenureTerms,
} from '@/lib/cemetery/terms';

interface SectionInfo {
  id: string;
  code: string;
  name: string;
  sitesPerRow: number;
}

/**
 * Interactive schematic layout of one cemetery: sections side by side (stacked on small screens), each a grid of
 * clickable grave sites coloured by sale status, with an occupied marker. A SCHEMATIC, not a survey or cadastral
 * map: positions are row/plot numbers only. Search matches site reference, rights holder or the deceased.
 */
export function CemeteryLayoutGrid({
  sections,
  sites,
  terms,
  canManage,
}: {
  sections: SectionInfo[];
  sites: RegisterSite[];
  terms: TenureTerms;
  canManage: boolean;
}) {
  const [status, setStatus] = useState<GraveSaleStatus | 'all'>('all');
  const [occupancy, setOccupancy] = useState<'all' | 'occupied' | 'unused'>('all');
  const [sectionId, setSectionId] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const set = new Set<string>();
    for (const s of sites) {
      if (status !== 'all' && s.saleStatus !== status) continue;
      if (occupancy !== 'all' && s.burialStatus !== occupancy) continue;
      if (sectionId !== 'all' && s.sectionId !== sectionId) continue;
      if (q) {
        const hay = [
          s.reference,
          s.sale?.purchaser.name,
          s.reservedFor?.name,
          ...s.burials.map((b) => b.name),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      set.add(s.id);
    }
    return set;
  }, [sites, status, occupancy, sectionId, q]);

  const filtering = status !== 'all' || occupancy !== 'all' || sectionId !== 'all' || q.length > 0;
  const counts = useMemo(() => {
    const c: Record<GraveSaleStatus, number> = {
      available: 0,
      reserved: 0,
      sold: 0,
      unavailable: 0,
    };
    for (const s of sites) c[s.saleStatus] += 1;
    return c;
  }, [sites]);
  const selected = sites.find((s) => s.id === selectedId) ?? null;
  const visibleSections = sections.filter((s) => sectionId === 'all' || s.id === sectionId);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search site, ${terms.holderLower} or deceased`}
            aria-label="Search grave sites"
            className="h-9 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="all">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by burial status"
            value={occupancy}
            onChange={(e) => setOccupancy(e.target.value as typeof occupancy)}
            className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="all">Any burial status</option>
            <option value="occupied">Occupied</option>
            <option value="unused">Unused</option>
          </select>
          {filtering ? (
            <button
              type="button"
              onClick={() => {
                setStatus('all');
                setOccupancy('all');
                setSectionId('all');
                setQuery('');
              }}
              className="h-9 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {/* Legend doubles as the status filter */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by sale status">
        <LegendChip
          active={status === 'all'}
          onClick={() => setStatus('all')}
          label={`All · ${sites.length}`}
        />
        {SALE_STATUSES.map((s) => (
          <LegendChip
            key={s}
            active={status === s}
            onClick={() => setStatus(status === s ? 'all' : s)}
            label={`${s === 'sold' ? terms.sold : SALE_STATUS_LABEL[s]} · ${counts[s]}`}
            swatch={SALE_STATUS_SWATCH[s]}
          />
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] text-muted-foreground">
          <Cross className="h-3 w-3" aria-hidden="true" /> = occupied (burial recorded)
        </span>
      </div>
      {filtering ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {matches.size} of {sites.length} sites match. Non-matching sites are dimmed.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Sections */}
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {visibleSections.map((section) => {
            const sectionSites = sites.filter((s) => s.sectionId === section.id);
            return (
              <section key={section.id} className="panel p-4" aria-label={section.name}>
                <header className="mb-3 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{section.name}</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {sectionSites.filter((s) => s.saleStatus === 'available').length} available of{' '}
                    {sectionSites.length}
                  </span>
                </header>
                <div
                  className="grid gap-1.5"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(section.sitesPerRow, 10)}, minmax(0, 1fr))`,
                  }}
                >
                  {sectionSites.map((site) => {
                    const dim = filtering && !matches.has(site.id);
                    const isSelected = site.id === selectedId;
                    return (
                      <button
                        key={site.id}
                        type="button"
                        onClick={() => setSelectedId(isSelected ? null : site.id)}
                        aria-pressed={isSelected}
                        aria-label={`${site.reference}: ${site.saleStatus === 'sold' ? terms.sold : SALE_STATUS_LABEL[site.saleStatus]}, ${BURIAL_STATUS_LABEL[site.burialStatus]}`}
                        title={`${site.reference} — ${site.saleStatus === 'sold' ? terms.sold : SALE_STATUS_LABEL[site.saleStatus]}${site.burialStatus === 'occupied' ? ', occupied' : ''}`}
                        className={`relative flex aspect-[3/4] min-h-[34px] flex-col items-center justify-center rounded-md border text-[10px] font-semibold tabular transition ${SALE_STATUS_TILE[site.saleStatus]} ${dim ? 'opacity-25' : ''} ${isSelected ? 'ring-2 ring-foreground ring-offset-1 ring-offset-card' : ''}`}
                      >
                        <span className="leading-none">
                          {String(site.siteNumber).padStart(2, '0')}
                        </span>
                        {site.burialStatus === 'occupied' ? (
                          <Cross className="mt-0.5 h-3 w-3 opacity-70" aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {/* Details panel: beside the grid on wide screens, below it on tablet/phone */}
        <aside className="panel h-fit p-4 xl:sticky xl:top-4" aria-live="polite">
          {selected ? (
            <SiteSummary
              site={selected}
              terms={terms}
              canManage={canManage}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Select a grave site to see its {terms.holderLower}, payments and burial status.
            </div>
          )}
        </aside>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Schematic layout for record-keeping — not a surveyed or cadastral map. Positions are
        section, row and plot numbers.
      </p>
    </div>
  );
}

function LegendChip({
  active,
  onClick,
  label,
  swatch,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  swatch?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-medium transition ${active ? 'border-foreground bg-foreground text-card' : 'border-border bg-card text-foreground hover:bg-surface'}`}
    >
      {swatch ? <span className={`h-2.5 w-2.5 rounded-sm ${swatch}`} aria-hidden="true" /> : null}
      {label}
    </button>
  );
}

function SiteSummary({
  site,
  terms,
  canManage,
  onClose,
}: {
  site: RegisterSite;
  terms: TenureTerms;
  canManage: boolean;
  onClose: () => void;
}) {
  const statusLabel = site.saleStatus === 'sold' ? terms.sold : SALE_STATUS_LABEL[site.saleStatus];
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Grave site</p>
          <h3 className="font-display text-xl font-bold text-foreground">{site.reference}</h3>
          <p className="text-xs text-muted-foreground">
            Section {site.sectionCode} · {site.rowLabel ?? '—'} · plot {site.plotPosition ?? '—'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded-md p-1 text-muted-foreground hover:bg-surface"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-[11px] font-medium text-foreground">
          <span
            className={`h-2 w-2 rounded-full ${SALE_STATUS_SWATCH[site.saleStatus]}`}
            aria-hidden="true"
          />
          {statusLabel}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-[11px] font-medium text-foreground">
          {BURIAL_STATUS_LABEL[site.burialStatus]}
          {site.maxInterments > 1
            ? ` · ${site.burials.length}/${site.maxInterments} interments`
            : ''}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
        {site.sale ? (
          <>
            <Item label={terms.holder} value={site.sale.purchaser.name} wide />
            <Item label={terms.price} value={formatZar(site.sale.price)} />
            <Item label="Paid" value={formatZar(site.sale.paid)} />
            <Item
              label="Outstanding"
              value={formatZar(site.sale.balance)}
              emphasis={site.sale.balance > 0}
            />
            <Item label="Date" value={formatDate(site.sale.saleDate)} />
          </>
        ) : site.saleStatus === 'reserved' ? (
          <>
            <Item label="Reserved for" value={site.reservedFor?.name ?? '—'} wide />
            <Item label="Until" value={formatDate(site.reservedUntil)} />
            <Item
              label="List price"
              value={site.listPrice != null ? formatZar(site.listPrice) : '—'}
            />
          </>
        ) : site.saleStatus === 'unavailable' ? (
          <Item label="Reason" value={site.unavailableReason ?? '—'} wide />
        ) : (
          <Item
            label="List price"
            value={site.listPrice != null ? formatZar(site.listPrice) : 'Not set'}
          />
        )}
        {site.burials.map((b, i) => (
          <Item
            key={i}
            label={`Interment ${i + 1}`}
            value={`${b.name} · ${formatDate(b.burialDate)}`}
            wide
          />
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href={`/cemetery/sites/${site.id}`}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-surface"
        >
          Open site record
        </Link>
        {canManage && (site.saleStatus === 'available' || site.saleStatus === 'reserved') ? (
          <Link
            href={`/cemetery/sales/new?siteId=${site.id}`}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            {terms.sellAction}
          </Link>
        ) : null}
        {site.sale ? (
          <Link
            href={`/cemetery/sales/${site.sale.id}`}
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-surface"
          >
            {site.sale.balance > 0 ? 'Record payment' : 'View sale record'}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Item({
  label,
  value,
  wide,
  emphasis,
}: {
  label: string;
  value: string;
  wide?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-medium ${emphasis ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </dd>
    </div>
  );
}
