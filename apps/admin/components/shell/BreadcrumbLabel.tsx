'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Human labels for opaque breadcrumb segments.
 *
 * Public UAT 2026-09-07 found the breadcrumb rendering raw identifiers: a property detail page
 * showed "Properties › 792ed2e3 63f5 4e82 B1fc Efd465cf8e9a" (the shell splits the pathname and
 * title-cases each segment, which mangles a UUID rather than hiding it), and invoice pages did the
 * same. AppShell is mounted by a route-group LAYOUT, so a page cannot hand it a prop directly --
 * hence this tiny context.
 *
 * Deliberately NOT a data fetch: the detail pages already load the entity server-side, so they pass
 * the nickname / invoice number they are about to render anyway. No extra API call is introduced.
 */
type BreadcrumbLabelMap = Record<string, string>;

const BreadcrumbLabelContext = createContext<{
  labels: BreadcrumbLabelMap;
  setLabel: (segment: string, label: string) => void;
} | null>(null);

export function BreadcrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<BreadcrumbLabelMap>({});
  const value = useMemo(
    () => ({
      labels,
      setLabel: (segment: string, label: string) =>
        // Only re-render when the label actually changes -- SetBreadcrumbLabel runs on every page
        // mount and would otherwise loop.
        setLabels((prev) => (prev[segment] === label ? prev : { ...prev, [segment]: label })),
    }),
    [labels],
  );
  return <BreadcrumbLabelContext.Provider value={value}>{children}</BreadcrumbLabelContext.Provider>;
}

export function useBreadcrumbLabels(): BreadcrumbLabelMap {
  return useContext(BreadcrumbLabelContext)?.labels ?? {};
}

/**
 * Registers a human label for one path segment. Render from a detail page with the id it appears
 * under and the name it already has, e.g.
 *   <SetBreadcrumbLabel segment={property.id} label={property.nickname} />
 */
export function SetBreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const ctx = useContext(BreadcrumbLabelContext);
  const setLabel = ctx?.setLabel;
  useEffect(() => {
    if (setLabel && segment && label) setLabel(segment, label);
  }, [setLabel, segment, label]);
  return null;
}

/** A path segment that carries no meaning for a reader -- a UUID, or a long opaque id. */
export function isOpaqueSegment(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{24,}$/i.test(segment)
  );
}
