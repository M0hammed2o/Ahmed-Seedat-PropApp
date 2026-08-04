'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

export interface MappableProperty {
  id: string;
  nickname: string;
  latitude: number;
  longitude: number;
}

// Real Mapbox GL map replacing Lovable's fake percentage-based dot placement
// (reference/lovable-ui-reference routes/index.tsx "Portfolio map") -- Mapbox chosen explicitly
// by Mohammed 2026-08-04. Renders only properties with real geocoded coordinates (apps/admin/lib/
// providers/geocoding.ts); the parent panel shows a "not available" message for the rest, never
// a fabricated position. `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` is a Mapbox *public* token by design --
// safe in client-side code, not a secret to protect.
export function PropertyMap({ properties }: { properties: MappableProperty[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const router = useRouter();

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token || !containerRef.current || properties.length === 0) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [properties[0]!.longitude, properties[0]!.latitude],
      zoom: 10,
    });
    mapRef.current = map;

    const bounds = new mapboxgl.LngLatBounds();
    for (const p of properties) {
      const marker = new mapboxgl.Marker({ color: '#106ADD' })
        .setLngLat([p.longitude, p.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 24 }).setText(p.nickname))
        .addTo(map);
      marker.getElement().style.cursor = 'pointer';
      marker.getElement().addEventListener('click', () => router.push(`/properties/${p.id}`));
      bounds.extend([p.longitude, p.latitude]);
    }
    if (properties.length > 1) map.fitBounds(bounds, { padding: 48, maxZoom: 12 });

    return () => map.remove();
    // Deliberately empty deps -- properties identity changes every render (new array from the
    // server payload); re-diffing markers isn't worth it for a dashboard panel that only
    // (re)mounts on navigation, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="h-[320px] w-full" />;
}
