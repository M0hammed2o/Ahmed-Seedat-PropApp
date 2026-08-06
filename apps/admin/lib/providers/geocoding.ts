import 'server-only';

// Vendor-scoped geocoding provider (same interface-based, swap-one-file pattern as
// TenantScreeningProvider/DocumentIntelligenceProvider) -- Mapbox chosen explicitly by Mohammed
// 2026-08-04 for the Owner Dashboard's real property map (Lovable-adoption batch follow-up).
// Unlike the OCR/screening providers, this one is NOT mock-first: Mapbox's Geocoding API needs
// only a free-tier public token (no paid vendor onboarding), so the real implementation is the
// only one -- but it still degrades to a clean no-op (never throws, never invents coordinates)
// when NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN isn't configured yet, matching every other
// not-yet-configured vendor in this codebase.

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export interface GeocodingProvider {
  geocode(address: string): Promise<GeocodeResult | null>;
}

/**
 * Real Mapbox Geocoding API v5 call, scoped to South Africa (`country=za`) matching this
 * product's single-jurisdiction focus (DECISIONS.md 2026-07-29). Uses the public (`pk.*`) token --
 * Mapbox's own documentation states public tokens are meant for exactly this kind of client- or
 * server-side call, not a secret to protect the way SUPABASE_SERVICE_ROLE_KEY is; the same
 * NEXT_PUBLIC_ token also drives the client-side map renderer (PropertyMap.tsx).
 */
export class MapboxGeocodingProvider implements GeocodingProvider {
  async geocode(address: string): Promise<GeocodeResult | null> {
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token) return null; // Not configured yet -- a real, disclosed gap, never a guessed coordinate.

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&country=za&limit=1`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return null; // Network/vendor failure -- geocoding is best-effort, never blocks the property write.
    }
    if (!response.ok) return null;

    const body = (await response.json()) as { features?: { center?: [number, number] }[] };
    const center = body.features?.[0]?.center;
    if (!center || center.length !== 2) return null;
    const [longitude, latitude] = center;
    return { latitude, longitude };
  }
}

class NullGeocodingProvider implements GeocodingProvider {
  async geocode(): Promise<GeocodeResult | null> {
    return null;
  }
}

export function getGeocodingProvider(): GeocodingProvider {
  return process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
    ? new MapboxGeocodingProvider()
    : new NullGeocodingProvider();
}
