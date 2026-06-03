"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LMap, CircleMarker, LayerGroup, Marker } from "leaflet";
import { Lead } from "@/lib/types";
import { leadLatLng, BALI_CENTER } from "@/lib/geo";

interface MapCanvasProps {
  leads: Lead[];
  scanning?: boolean;
  latest?: Lead | null;       // most recently found lead, gets a pulse + pan
  selectedId?: string | null;
  onSelect?: (lead: Lead) => void;
  recenter?: number;          // bump this number to re-frame Bali
}

// the whole island of Bali
const BALI_BOUNDS: [[number, number], [number, number]] = [[-8.95, 114.40], [-8.05, 115.75]];

const leadColor = (l: Lead): string => {
  if (l.websiteStatus === "none") return "#0D9488";          // teal, prime no-website leads
  if (l.websiteStatus === "unreachable") return "#DC2626";
  const s = l.stats?.score ?? 0;
  return s >= 70 ? "#0E9F6E" : s >= 40 ? "#C2710C" : "#DC2626";
};

export default function MapCanvas({ leads, scanning, latest, selectedId, onSelect, recenter }: MapCanvasProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const pulseRef = useRef<Marker | null>(null);
  const markersRef = useRef<Map<string, CircleMarker>>(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // init map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, {
        center: [BALI_CENTER.lat, BALI_CENTER.lng],
        zoom: 10,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        zoomSnap: 0.25,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      // frame the whole island of Bali on load, regardless of where leads sit
      map.fitBounds(BALI_BOUNDS, { padding: [20, 20] });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.control.attribution({ position: "bottomleft", prefix: false })
        .addAttribution("© OpenStreetMap, © CARTO").addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      // first paint can land before container has size; nudge it
      setTimeout(() => map.invalidateSize(), 200);
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // (re)build markers when leads change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current; const layer = layerRef.current;
      if (cancelled || !map || !layer) return;
      layer.clearLayers();
      markersRef.current.clear();
      for (const lead of leads) {
        const c = leadLatLng(lead);
        if (!c) continue;
        const color = leadColor(lead);
        const sel = selectedId && String(lead.id) === String(selectedId);
        const m = L.circleMarker([c.lat, c.lng], {
          radius: sel ? 8 : 5,
          color: sel ? "#0F1A18" : color,
          weight: sel ? 2 : 1.25,
          fillColor: color,
          fillOpacity: 0.6,
          opacity: 0.9,
        });
        m.bindTooltip(lead.name, { direction: "top", offset: [0, -4], opacity: 0.95 });
        m.on("click", () => onSelectRef.current?.(lead));
        m.addTo(layer);
        markersRef.current.set(String(lead.id), m);
      }
    })();
    return () => { cancelled = true; };
    // selectedId handled here too so the highlighted marker restyles
  }, [leads, selectedId]);

  // pulse + gently follow the latest found lead while scanning
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (cancelled || !map) return;
      if (pulseRef.current) { pulseRef.current.remove(); pulseRef.current = null; }
      const c = scanning && latest ? leadLatLng(latest) : null;
      if (!c) return;
      const icon = L.divIcon({ className: "", html: '<div class="map-pulse"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
      pulseRef.current = L.marker([c.lat, c.lng], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      map.panTo([c.lat, c.lng], { animate: true, duration: 0.8 });
    })();
    return () => { cancelled = true; };
  }, [latest, scanning]);

  // re-frame Bali when the parent bumps `recenter` (e.g. clicking the title)
  useEffect(() => {
    if (!recenter) return; // skip the initial 0
    mapRef.current?.fitBounds(BALI_BOUNDS, { padding: [20, 20], animate: true });
  }, [recenter]);

  return <div ref={elRef} className="absolute inset-0 z-0" aria-label="Lead map" />;
}
