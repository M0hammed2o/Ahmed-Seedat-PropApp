'use client';

import { useEffect, useRef, useState } from 'react';

// Stage 3: address search-as-you-type. Reuses the same Mapbox public token
// (NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) and client-side-call pattern PropertyMap.tsx already
// established -- Mapbox's own docs say a `pk.*` public token is meant for exactly this kind of
// browser call, not a secret to proxy through a server route. When the token isn't configured,
// this component renders nothing and the plain manual address fields below it keep working
// unchanged -- autocomplete is additive, never a blocker to creating a property.

export interface AddressSuggestion {
  placeName: string;
  addressLine1: string;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  latitude: number;
  longitude: number;
  mapboxId: string;
}

interface MapboxFeature {
  id: string;
  place_name: string;
  text: string;
  address?: string;
  center: [number, number];
  context?: { id: string; text: string; short_code?: string }[];
}

function parseFeature(f: MapboxFeature): AddressSuggestion {
  const context = f.context ?? [];
  const find = (prefix: string) => context.find((c) => c.id.startsWith(prefix))?.text ?? null;
  const countryEntry = context.find((c) => c.id.startsWith('country'));
  return {
    placeName: f.place_name,
    addressLine1: f.address ? `${f.address} ${f.text}` : f.text,
    suburb: find('neighborhood') ?? find('locality'),
    city: find('place'),
    province: find('region'),
    postalCode: find('postcode'),
    country: countryEntry?.short_code ? countryEntry.short_code.toUpperCase() : 'ZA',
    latitude: f.center[1],
    longitude: f.center[0],
    mapboxId: f.id,
  };
}

export function AddressAutocomplete({ onSelect }: { onSelect: (s: AddressSuggestion) => void }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const token =
    typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN : undefined;

  useEffect(() => {
    if (!token) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?autocomplete=true&country=za&limit=5&access_token=${token}`;
        const response = await fetch(url);
        if (!response.ok) {
          setSuggestions([]);
          return;
        }
        const body = (await response.json()) as { features?: MapboxFeature[] };
        setSuggestions((body.features ?? []).map(parseFeature));
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, token]);

  if (!token) return null;

  return (
    <div className="relative">
      <label className="block text-xs">
        <span className="text-light-textMuted dark:text-dark-textMuted">
          Search for an address (optional)
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Start typing an address…"
          className="mt-1 block w-full rounded-md border border-light-border bg-transparent px-3 py-2 text-sm text-light-textPrimary dark:border-dark-border dark:text-dark-textPrimary"
        />
      </label>
      {loading ? (
        <p className="mt-1 text-[11px] text-light-textMuted dark:text-dark-textMuted">Searching…</p>
      ) : null}
      {open && suggestions.length > 0 ? (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-light-border bg-light-surface shadow-lg dark:border-dark-border dark:bg-dark-surface">
          {suggestions.map((s) => (
            <li key={s.mapboxId}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-xs text-light-textPrimary hover:bg-light-hover dark:text-dark-textPrimary dark:hover:bg-dark-hover"
                onClick={() => {
                  onSelect(s);
                  setQuery(s.placeName);
                  setOpen(false);
                }}
              >
                {s.placeName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-[11px] text-light-textMuted dark:text-dark-textMuted">
        Selecting a result fills in the fields below — every field stays editable, and you can skip
        this and enter the address manually.
      </p>
    </div>
  );
}
