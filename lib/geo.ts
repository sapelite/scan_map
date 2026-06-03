// lib/geo.ts
// Turn a lead into a map coordinate. Google Maps place URLs embed the real
// lat/lng (e.g. ...!3d-8.64!4d115.13), so we parse that first; otherwise we fall
// back to the centroid of whichever Bali area appears in the address, with a
// small deterministic jitter so many leads in one area fan out instead of stacking.
import { Lead } from "./types";

export type LatLng = { lat: number; lng: number };

/** Approx centroids for the Bali areas we sweep. */
export const BALI_AREA_COORDS: Record<string, LatLng> = {
  Canggu: { lat: -8.6478, lng: 115.1385 },
  Berawa: { lat: -8.6600, lng: 115.1400 },
  Pererenan: { lat: -8.6450, lng: 115.1200 },
  Seminyak: { lat: -8.6913, lng: 115.1686 },
  Kerobokan: { lat: -8.6700, lng: 115.1600 },
  Legian: { lat: -8.7050, lng: 115.1680 },
  Kuta: { lat: -8.7215, lng: 115.1686 },
  Ubud: { lat: -8.5069, lng: 115.2625 },
  Uluwatu: { lat: -8.8291, lng: 115.0849 },
  Pecatu: { lat: -8.8100, lng: 115.1000 },
  Jimbaran: { lat: -8.7905, lng: 115.1577 },
  "Nusa Dua": { lat: -8.8008, lng: 115.2317 },
  Sanur: { lat: -8.6878, lng: 115.2625 },
  Denpasar: { lat: -8.6705, lng: 115.2126 },
  Tabanan: { lat: -8.5376, lng: 115.1257 },
  Gianyar: { lat: -8.5447, lng: 115.3258 },
  "Nusa Penida": { lat: -8.7273, lng: 115.5444 },
  "Nusa Lembongan": { lat: -8.6817, lng: 115.4500 },
  Amed: { lat: -8.3373, lng: 115.6875 },
  Lovina: { lat: -8.1583, lng: 115.0258 },
};

/** Center + default zoom for the map (Bali). */
export const BALI_CENTER: LatLng = { lat: -8.65, lng: 115.18 };

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Pull lat/lng out of a Google Maps place URL. */
export function parseLatLng(url?: string | null): LatLng | null {
  if (!url) return null;
  let m = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!m) m = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]); const lng = parseFloat(m[2]);
  return valid(lat, lng) ? { lat, lng } : null;
}

// stable pseudo-random in [-1,1] from a string, so jitter doesn't move on re-render
function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Best-effort map coordinate for a lead. */
export function leadLatLng(lead: Lead): LatLng | null {
  const exact = parseLatLng(lead.mapsUrl);
  if (exact) return exact;

  const addr = (lead.address || "").toLowerCase();
  const area = Object.keys(BALI_AREA_COORDS).find((a) => addr.includes(a.toLowerCase()));
  if (area) {
    const c = BALI_AREA_COORDS[area];
    const seed = lead.id || lead.name || area;
    return { lat: c.lat + hashUnit(seed + "a") * 0.012, lng: c.lng + hashUnit(seed + "b") * 0.012 };
  }
  return null;
}
