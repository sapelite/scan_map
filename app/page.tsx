"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Lead, LeadStatus, STATUS_OPTIONS } from "@/lib/types";
import { generatePdf } from "@/lib/pdf";
import { peerBenchmark } from "@/lib/benchmark";
import { buildWhatsApp, waRecipient } from "@/lib/outreach";
import { ToastProvider, useToast } from "@/components/Toast";
import { LeadDetail } from "@/components/LeadDetail";
import { CrmToolbar, SortKey, QuickFilterKey, matchesQuickFilter, quickFilterCounts } from "@/components/CrmToolbar";
import { SWEEP_PRESETS, BALI_AREAS, BALI_DEFAULT_AREAS } from "@/lib/bali";
import { leadValue } from "@/lib/leadValue";
import { DIM_FULL, DIM_ORDER } from "@/components/Presence";

// Full-page map is client-only (Leaflet needs the browser).
const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-background" />,
});

const TIER_INFO: Record<string, { scan: number; deliver: number; sub: string }> = {
  Free:    { scan: 10,  deliver: 3,   sub: "3 leads per search" },
  Pro:     { scan: 40,  deliver: 15,  sub: "15 leads per search" },
  Premium: { scan: 150, deliver: 150, sub: "150 leads per search" },
};

const RECENT_KEY = "scanmap_recent_v2";
type RecentSearch = { niche: string; location: string; tier: string; websiteFilter?: WebFilter; ts: number };
type View = "sweep" | "find" | "crm";

type WebFilter = "none_only" | "with_only" | "any";
const WEBSITE_FILTERS: { key: WebFilter; label: string; hint: string }[] = [
  { key: "none_only", label: "No website", hint: "Only businesses with no website. These are your prime website-build leads." },
  { key: "with_only", label: "Has a website", hint: "Only businesses that already have a website (good for redesign, SEO, social and marketing pitches)." },
  { key: "any", label: "Both", hint: "Businesses with or without a website." },
];
function WebsiteFilterPicker({ value, onChange }: { value: WebFilter; onChange: (v: WebFilter) => void }) {
  const active = WEBSITE_FILTERS.find((f) => f.key === value);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {WEBSITE_FILTERS.map((f) => (
          <button key={f.key} onClick={() => onChange(f.key)} title={f.hint}
            className={`chip chip-interactive ${value === f.key ? "chip-active" : ""}`}>
            {f.label}
          </button>
        ))}
      </div>
      {active && <p className="text-xs text-muted-foreground mt-2">{active.hint}</p>}
    </div>
  );
}

const RECENT_SWEEPS_KEY = "scanmap_recent_sweeps_v1";
type RecentSweep = { niches: string[]; areas: string[]; perCombo: number; websiteFilter: WebFilter; ts: number };
type SweepConfigData = { niches: string[]; areas: string[]; perCombo: number; websiteFilter: WebFilter };
type SweepProgress = { i: number; total: number; found: number; saved: number; skipped: number; noWeb: number };

// ============================================================================
// Shared bits
// ============================================================================

function ScoreDistribution({ leads }: { leads: Lead[] }) {
  const buckets = useMemo(() => {
    const b = [0, 0, 0, 0, 0];
    for (const l of leads) { const s = l.stats?.score ?? 0; b[Math.min(Math.floor(s / 20), 4)]++; }
    return b;
  }, [leads]);
  const max = Math.max(1, ...buckets);
  const labels = ["0-19", "20-39", "40-59", "60-79", "80+"];
  const colors = ["#DC2626", "#E8590C", "#C2710C", "#0E9F6E", "#0B7A52"];
  return (
    <div className="card-flat p-5 col-span-2">
      <div className="label-overline mb-3">Opportunity spread (lower = hotter)</div>
      <div className="flex items-end gap-3 h-20">
        {buckets.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2">
            <div className="w-full rounded-sm transition-all" style={{ height: `${(count / max) * 100}%`, minHeight: count > 0 ? "6px" : "2px", background: count === 0 ? "rgba(29,29,31,0.06)" : colors[i] }} title={`${count} lead(s)`} />
            <div className="text-[10px] text-muted-foreground tabular-nums">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

type OppRow = { key: string; total: number; noWeb: number; avg: number };
function rankOpportunity(leads: Lead[], keyFn: (l: Lead) => string): OppRow[] {
  const map = new Map<string, { total: number; noWeb: number; sum: number; scored: number }>();
  for (const l of leads) {
    const k = keyFn(l);
    if (!k) continue;
    const e = map.get(k) ?? { total: 0, noWeb: 0, sum: 0, scored: 0 };
    e.total++;
    if (l.websiteStatus === "none") e.noWeb++;
    if (typeof l.stats?.score === "number") { e.sum += l.stats.score; e.scored++; }
    map.set(k, e);
  }
  return [...map.entries()]
    .map(([key, e]) => ({ key, total: e.total, noWeb: e.noWeb, avg: e.scored ? Math.round(e.sum / e.scored) : 0 }))
    .sort((a, b) => b.noWeb - a.noWeb || b.total - a.total)
    .slice(0, 6);
}

function InsightList({ title, rows }: { title: string; rows: OppRow[] }) {
  if (rows.length === 0) return (
    <div><div className="label-overline mb-2">{title}</div><p className="text-xs text-muted-foreground">Not enough data yet.</p></div>
  );
  return (
    <div>
      <div className="label-overline mb-3">{title}</div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-foreground truncate capitalize">{r.key}</span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">{r.noWeb} no-website / {r.total}</span>
            </div>
            <div className="meter"><span style={{ width: `${(r.noWeb / Math.max(r.total, 1)) * 100}%`, background: "var(--teal)" }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpportunityInsights({ leads }: { leads: Lead[] }) {
  const byNiche = useMemo(() => rankOpportunity(leads, (l) => (l.category || "").trim()), [leads]);
  const byArea = useMemo(() => rankOpportunity(leads, (l) => BALI_AREAS.find((a) => (l.address || "").toLowerCase().includes(a.toLowerCase())) || ""), [leads]);
  if (leads.length === 0) return null;
  return (
    <details className="panel mb-6 group">
      <summary className="panel-head cursor-pointer list-none">
        <span className="panel-title">Where the opportunity is</span>
        <span className="panel-meta group-open:hidden">show</span>
        <span className="panel-meta hidden group-open:inline">hide</span>
      </summary>
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        <InsightList title="Top niches by no-website leads" rows={byNiche} />
        <InsightList title="Top areas by no-website leads" rows={byArea} />
      </div>
    </details>
  );
}

function ScoringLegend() {
  return (
    <details className="panel mb-6 group">
      <summary className="panel-head cursor-pointer list-none">
        <span className="panel-title">How the Digital Presence score works</span>
        <span className="panel-meta group-open:hidden">show</span>
        <span className="panel-meta hidden group-open:inline">hide</span>
      </summary>
      <div className="p-5 pt-4 text-sm text-muted-foreground space-y-3">
        <p>
          Every business gets one <strong className="text-foreground">Digital Presence score from 0 to 100</strong>.
          A <strong className="text-foreground">lower score means a bigger opportunity</strong> for you,
          more gaps to sell into. It rolls up five dimensions:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {DIM_ORDER.map((k) => (
            <div key={k} className="flex gap-2">
              <span className="label-overline w-20 shrink-0 pt-0.5">{k}</span>
              <span className="text-foreground/80 text-[13px]">{DIM_FULL[k]}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

// ---- Map marker legend ----
function MapLegend() {
  const items: [string, string][] = [
    ["#34C759", "No website"],
    ["#0E9F6E", "Strong (70+)"],
    ["#C2710C", "Some gaps"],
    ["#DC2626", "Weak / down"],
  ];
  return (
    <div className="pointer-events-none fixed z-30 left-3 top-[4.75rem]">
      <div className="pointer-events-auto panel px-3 py-2.5 shadow-sm">
        <div className="label-overline mb-2">Leads</div>
        <div className="space-y-1.5">
          {items.map(([c, l]) => (
            <div key={l} className="flex items-center gap-2 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c }} />
              <span className="text-muted-foreground whitespace-nowrap">{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Draggable floating panel over the map. Position is saved per view in
//      localStorage. On mobile it's a full-screen sheet (no dragging). ----
function Modal({ title, onClose, wide, storageKey, children }: { title: string; onClose: () => void; wide?: boolean; storageKey: string; children: React.ReactNode }) {
  const KEY = `scanmap_modalpos_${storageKey}`;
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDesktop, setIsDesktop] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number; baseLeft: number; baseTop: number; w: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () => setIsDesktop(mq.matches);
    update(); mq.addEventListener("change", update);
    try { const raw = localStorage.getItem(KEY); if (raw) setOffset(JSON.parse(raw)); } catch {}
    return () => mq.removeEventListener("change", update);
  }, [KEY]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isDesktop) return;
    if ((e.target as HTMLElement).closest("button")) return; // don't drag when hitting the close button
    const el = panelRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y, baseLeft: r.left - offset.x, baseTop: r.top - offset.y, w: r.width };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const left = d.baseLeft + d.ox + (e.clientX - d.px);
    const top = d.baseTop + d.oy + (e.clientY - d.py);
    const cl = Math.min(Math.max(left, 120 - d.w), window.innerWidth - 120);
    const ct = Math.min(Math.max(top, 8), window.innerHeight - 48);
    setOffset({ x: cl - d.baseLeft, y: ct - d.baseTop });
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try { localStorage.setItem(KEY, JSON.stringify(offset)); } catch {}
  };
  const resetPos = () => { setOffset({ x: 0, y: 0 }); try { localStorage.removeItem(KEY); } catch {} };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-start justify-center sm:p-6 pointer-events-none">
      <div
        ref={panelRef}
        style={isDesktop ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
        className={`pointer-events-auto bg-background w-full ${wide ? "max-w-6xl" : "max-w-3xl"} flex flex-col h-full sm:h-auto sm:max-h-[88vh] sm:rounded-lg border border-border shadow-lg animate-in zoom-in-95 duration-200 overflow-hidden`}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={resetPos}
          className={`bg-background/90 backdrop-blur-md border-b border-border px-5 py-3 flex items-center justify-between shrink-0 ${isDesktop ? "cursor-move select-none" : ""}`}
          title={isDesktop ? "Drag to move · double-click to reset" : undefined}
        >
          <span className="label-section">{title}</span>
          <button onClick={onClose} className="w-8 h-8 rounded-sm bg-muted hover:bg-foreground hover:text-white flex items-center justify-center text-muted-foreground transition-colors" aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

// ---- Floating scan status over the map ----
function ScanStatus({ kind, scanning, logs, progress, found, onStop, onDismiss, onViewLibrary }: {
  kind: "sweep" | "find"; scanning: boolean; logs: string[]; progress: SweepProgress; found: number;
  onStop: () => void; onDismiss: () => void; onViewLibrary: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs]);
  return (
    <div className="fixed z-40 left-3 bottom-3 w-[min(92vw,360px)] panel shadow-lg overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
      <div className="panel-head">
        <div className="flex items-center gap-2">
          <span className={`status-dot ${scanning ? "animate-pulse" : ""}`} style={{ background: scanning ? "var(--warn)" : "var(--good)" }} />
          <span className="panel-title">{scanning ? (kind === "sweep" ? "Sweeping" : "Searching") : "Complete"}</span>
        </div>
        {scanning
          ? <button onClick={onStop} className="btn btn-danger btn-sm">Stop</button>
          : <button onClick={onDismiss} className="btn btn-ghost btn-sm">Dismiss</button>}
      </div>
      {scanning && kind === "sweep" && (
        <div className="w-full h-0.5 bg-muted relative">
          <div className="absolute top-0 left-0 h-full transition-all duration-500" style={{ width: `${progress.total ? (progress.i / progress.total) * 100 : 0}%`, background: "var(--teal)" }} />
        </div>
      )}
      <div className="px-4 py-2 text-[11px] tabular-nums text-muted-foreground border-b border-border">
        {kind === "sweep"
          ? `${progress.i}/${progress.total} searches · ${progress.found} found · ${progress.noWeb} no-website · ${progress.saved} new`
          : `${found} found`}
      </div>
      <div ref={logRef} className="h-24 overflow-y-auto px-4 py-2 font-mono text-[11px] space-y-1">
        {logs.slice(-50).map((l, i) => (
          <div key={i} className={l.includes("FOUND") ? "text-[#0E9F6E]" : l.includes("ERROR") ? "text-[#DC2626]" : "text-muted-foreground"}>{l}</div>
        ))}
      </div>
      {!scanning && found > 0 && (
        <button onClick={onViewLibrary} className="btn btn-secondary btn-sm w-full" style={{ borderRadius: 0 }}>View {found} in Library</button>
      )}
    </div>
  );
}

// ============================================================================
// Sweep config (the form; the run itself lives in the parent so it keeps going
// after this modal closes and you watch the map fill)
// ============================================================================

function SweepConfig({ onRun, running }: { onRun: (c: SweepConfigData) => void; running: boolean }) {
  const toast = useToast();
  const [niches, setNiches] = useState<Set<string>>(new Set(SWEEP_PRESETS[0].niches));
  const [areas, setAreas] = useState<Set<string>>(new Set(BALI_DEFAULT_AREAS));
  const [perCombo, setPerCombo] = useState(5);
  const [websiteFilter, setWebsiteFilter] = useState<WebFilter>("none_only");
  const [recentSweeps, setRecentSweeps] = useState<RecentSweep[]>([]);
  useEffect(() => { try { const raw = localStorage.getItem(RECENT_SWEEPS_KEY); if (raw) setRecentSweeps(JSON.parse(raw)); } catch {} }, []);
  const sweepKey = (s: RecentSweep) => `${[...s.niches].sort().join(",")}|${[...s.areas].sort().join(",")}|${s.perCombo}|${s.websiteFilter}`;
  const saveRecent = (entry: RecentSweep) => {
    setRecentSweeps((prev) => {
      const next = [entry, ...prev.filter((s) => sweepKey(s) !== sweepKey(entry))].slice(0, 6);
      try { localStorage.setItem(RECENT_SWEEPS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const restore = (s: RecentSweep) => { setNiches(new Set(s.niches)); setAreas(new Set(s.areas)); setPerCombo(s.perCombo); setWebsiteFilter(s.websiteFilter); };
  const togglePreset = (preset: typeof SWEEP_PRESETS[number]) => {
    setNiches((prev) => { const next = new Set(prev); const allOn = preset.niches.every((n) => next.has(n)); preset.niches.forEach((n) => (allOn ? next.delete(n) : next.add(n))); return next; });
  };
  const toggleNiche = (n: string) => setNiches((p) => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; });
  const toggleArea = (a: string) => setAreas((p) => { const s = new Set(p); s.has(a) ? s.delete(a) : s.add(a); return s; });

  const comboCount = niches.size * areas.size;
  const estLeads = comboCount * perCombo;
  const estMinutes = Math.round((estLeads * 7) / 60);

  const start = () => {
    if (niches.size === 0 || areas.size === 0) { toast.push("Pick at least one niche and one area", "warn"); return; }
    const cfg = { niches: [...niches], areas: [...areas], perCombo, websiteFilter };
    saveRecent({ ...cfg, ts: Date.now() });
    onRun(cfg);
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-5">
        Pick what to hunt and where. Scanmap sweeps Google Maps area by area, audits each business&apos;s full
        digital presence, and plots every lead on the map as it goes, skipping anyone you&apos;ve already found.
      </p>

      <ScoringLegend />

      {recentSweeps.length > 0 && (
        <section className="mb-6">
          <div className="label-overline mb-2">Recent sweeps</div>
          <div className="flex flex-wrap gap-2">
            {recentSweeps.map((s, i) => {
              const fl = s.websiteFilter === "none_only" ? "No website" : s.websiteFilter === "with_only" ? "Has site" : "Both";
              return (
                <button key={i} onClick={() => restore(s)} title={`${s.niches.join(", ")}\nin ${s.areas.join(", ")}\n${s.perCombo} per area, ${fl}`} className="chip chip-interactive">
                  {(s.niches[0] ?? "?")}{s.niches.length > 1 ? ` +${s.niches.length - 1}` : ""} <span style={{ color: "var(--tertiary-foreground)" }}>·</span> {(s.areas[0] ?? "?")}{s.areas.length > 1 ? ` +${s.areas.length - 1}` : ""} <span style={{ color: "var(--tertiary-foreground)" }}>·</span> {fl}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="label-section">1 · What to hunt</span>
            <span className="panel-meta">{niches.size} niches</span>
          </div>
          <div className="space-y-3">
            {SWEEP_PRESETS.map((p) => {
              const allOn = p.niches.every((n) => niches.has(n));
              const someOn = p.niches.some((n) => niches.has(n));
              return (
                <div key={p.id}>
                  <button onClick={() => togglePreset(p)} className={`chip chip-interactive ${allOn ? "chip-active" : someOn ? "chip-active opacity-70" : ""}`}>
                    {p.label} <span className="text-[10px] opacity-70">{p.niches.length}</span>
                  </button>
                  <div className="flex flex-wrap gap-1.5 mt-1.5 pl-1">
                    {p.niches.map((n) => (
                      <button key={n} onClick={() => toggleNiche(n)} className={`chip chip-interactive text-[10px] ${niches.has(n) ? "chip-active" : ""}`}>{n}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="label-section">2 · Where</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setAreas(new Set(BALI_AREAS))} className="btn btn-ghost btn-sm">All</button>
              <button onClick={() => setAreas(new Set(BALI_DEFAULT_AREAS))} className="btn btn-ghost btn-sm">Reset</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BALI_AREAS.map((a) => (
              <button key={a} onClick={() => toggleArea(a)} className={`chip chip-interactive ${areas.has(a) ? "chip-active" : ""}`}>{a}</button>
            ))}
          </div>
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="label-section">3 · Depth</span>
              <span className="panel-meta tabular-nums">{perCombo} per area·niche</span>
            </div>
            <input type="range" min={3} max={20} value={perCombo} onChange={(e) => setPerCombo(Number(e.target.value))} className="w-full accent-(--teal)" />
          </div>
          <div className="mt-5 pt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2"><span className="label-section">4 · Which businesses</span></div>
            <WebsiteFilterPicker value={websiteFilter} onChange={setWebsiteFilter} />
          </div>
        </div>
      </section>

      <section className="panel p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          <span className="text-foreground font-medium tabular-nums">{comboCount}</span> searches ·
          up to <span className="text-foreground font-medium tabular-nums">{estLeads}</span> leads ·
          ~<span className="text-foreground font-medium tabular-nums">{estMinutes || "<1"}</span> min
          {estLeads > 300 && <span className="text-[#C2710C]"> · large sweep, consider narrowing</span>}
        </div>
        {running ? (
          <button disabled className="btn btn-secondary w-full sm:w-auto opacity-70">Sweep running… (stop on the map)</button>
        ) : (
          <button onClick={start} className="btn btn-primary w-full sm:w-auto">Start Bali sweep</button>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// Main
// ============================================================================

function CommandCenterInner() {
  const [view, setView] = useState<View | null>(null);
  const [vaultLeads, setVaultLeads] = useState<Lead[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);

  // unified scan state (shared by sweep + find), so the map and floating status
  // keep updating while the config modal is closed.
  const [scanning, setScanning] = useState(false);
  const [scanKind, setScanKind] = useState<"sweep" | "find" | null>(null);
  const [liveLeads, setLiveLeads] = useState<Lead[]>([]);
  const [latestLead, setLatestLead] = useState<Lead | null>(null);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [sweepProgress, setSweepProgress] = useState<SweepProgress>({ i: 0, total: 0, found: 0, saved: 0, skipped: 0, noWeb: 0 });
  const scanAbort = useRef<AbortController | null>(null);

  // find config
  const [tier, setTier] = useState<keyof typeof TIER_INFO>("Pro");
  const [findWebsiteFilter, setFindWebsiteFilter] = useState<WebFilter>("none_only");
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [recent, setRecent] = useState<RecentSearch[]>([]);

  // crm / library
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | LeadStatus>("ALL");
  const [techFilter, setTechFilter] = useState("ALL");
  const [quickFilters, setQuickFilters] = useState<Set<QuickFilterKey>>(new Set());
  const [sort, setSort] = useState<SortKey>("value_desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);
  const [bulkReaudit, setBulkReaudit] = useState<{ active: boolean; done: number; total: number; msg: string }>({ active: false, done: 0, total: 0, msg: "" });
  const toast = useToast();

  useEffect(() => { try { const raw = localStorage.getItem(RECENT_KEY); if (raw) setRecent(JSON.parse(raw)); } catch {} }, []);

  const fetchVault = useCallback(() => {
    setVaultLoading(true);
    fetch("/api/leads").then((r) => r.json()).then((d) => setVaultLeads(d)).catch(() => toast.push("Failed to load", "error")).finally(() => setVaultLoading(false));
  }, [toast]);

  useEffect(() => { fetchVault(); }, [fetchVault]);            // load leads onto the map at start
  useEffect(() => { if (view === "crm") fetchVault(); }, [view, fetchVault]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k" && view === "crm") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[placeholder^="Search"]')?.focus();
      }
      if (e.key === "Escape") setPurgeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  // leads shown on the map: live scan results layered over the saved library
  const mapLeads = useMemo(() => {
    if (liveLeads.length === 0) return vaultLeads;
    const ids = new Set(liveLeads.map((l) => String(l.id)));
    return [...liveLeads, ...vaultLeads.filter((l) => !ids.has(String(l.id)))];
  }, [vaultLeads, liveLeads]);

  const stats = useMemo(() => {
    const total = vaultLeads.length;
    const closed = vaultLeads.filter((l) => l.status === "CLOSED").length;
    const contacted = vaultLeads.filter((l) => l.status === "CONTACTED").length;
    const rate = total > 0 ? Math.round((closed / total) * 100) : 0;
    const avgScore = total > 0 ? Math.round(vaultLeads.reduce((s, l) => s + (l.stats?.score ?? 0), 0) / total) : 0;
    const noWebsite = vaultLeads.filter((l) => matchesQuickFilter(l, "no_website")).length;
    const techMap: Record<string, number> = {};
    for (const l of vaultLeads) { const k = l.tech || "Unknown"; techMap[k] = (techMap[k] || 0) + 1; }
    const topTech = Object.entries(techMap).sort((a, b) => b[1] - a[1])[0];
    return { total, closed, contacted, rate, avgScore, noWebsite, topTech };
  }, [vaultLeads]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STATUS_OPTIONS) c[s] = 0;
    for (const l of vaultLeads) { const s = l.status || "NEW"; c[s] = (c[s] || 0) + 1; }
    return c;
  }, [vaultLeads]);

  const techOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of vaultLeads) if (l.tech) set.add(l.tech);
    return [...set].sort();
  }, [vaultLeads]);

  const quickCounts = useMemo(() => quickFilterCounts(vaultLeads), [vaultLeads]);

  const filteredLeads = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    const out = vaultLeads.filter((l) => {
      if (statusFilter !== "ALL" && (l.status || "NEW") !== statusFilter) return false;
      if (techFilter !== "ALL" && l.tech !== techFilter) return false;
      if (q) {
        const hay = `${l.name} ${l.email ?? ""} ${l.tech ?? ""} ${l.address ?? ""} ${l.category ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const k of quickFilters) { if (!matchesQuickFilter(l, k)) return false; }
      return true;
    });
    return [...out].sort((a, b) => {
      switch (sort) {
        case "value_desc": return leadValue(b) - leadValue(a);
        case "score_desc": return (b.stats?.score ?? 0) - (a.stats?.score ?? 0);
        case "score_asc":  return (a.stats?.score ?? 0) - (b.stats?.score ?? 0);
        case "name_asc":   return a.name.localeCompare(b.name);
        case "date_desc":  return (b.date ?? "").localeCompare(a.date ?? "");
        default:           return leadValue(b) - leadValue(a);
      }
    });
  }, [vaultLeads, searchTerm, statusFilter, techFilter, quickFilters, sort]);

  // arrow keys / J,K to move between leads while the detail panel is open
  useEffect(() => {
    if (!openLead) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (!["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) return;
      const idx = filteredLeads.findIndex((l) => String(l.id) === String(openLead.id));
      if (idx === -1) return;
      const next = (e.key === "ArrowDown" || e.key === "j") ? idx + 1 : idx - 1;
      if (next >= 0 && next < filteredLeads.length) { e.preventDefault(); setOpenLead(filteredLeads[next]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLead, filteredLeads]);

  const toggleQuickFilter = (k: QuickFilterKey) => setQuickFilters((prev) => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next; });
  const clearQuickFilters = () => setQuickFilters(new Set());
  const allFilteredSelected = filteredLeads.length > 0 && filteredLeads.every((l) => selectedIds.has(String(l.id)));
  const toggleSelectAll = () => { if (allFilteredSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(filteredLeads.map((l) => String(l.id)))); };
  const toggleOne = (id: string) => setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const commitStatusChange = async (id: string, nextStatus: string) => {
    try {
      const response = await fetch(`/api/leads/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentStatus: nextStatus }) });
      if (response.ok) {
        // Mirror the server stamping the contact time, so "follow up" shows right away.
        const patch = (l: Lead): Lead => ({ ...l, status: nextStatus, ...(nextStatus === "CONTACTED" ? { contactedAt: new Date().toISOString() } : {}) });
        setVaultLeads((prev) => prev.map((l) => (String(l.id) === String(id) ? patch(l) : l)));
        if (openLead && String(openLead.id) === String(id)) setOpenLead(patch(openLead));
      } else toast.push("Update failed", "error");
    } catch { toast.push("Update failed", "error"); }
  };

  const onNotesSaved = (id: string, notes: string) => setVaultLeads((prev) => prev.map((l) => (String(l.id) === id ? { ...l, notes } : l)));

  const handleQuickStrike = (lead: Lead) => {
    if (!lead.email || lead.email === "No email found" || lead.email === "No Email Found") { toast.push("No email on file", "warn"); return; }
    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(lead.name)}`;
  };

  const executePurge = async () => {
    if (!purgeId) return;
    try {
      const response = await fetch(`/api/leads/${purgeId}`, { method: "DELETE" });
      if (response.ok) {
        setVaultLeads((prev) => prev.filter((l) => String(l.id) !== String(purgeId)));
        if (openLead && String(openLead.id) === purgeId) setOpenLead(null);
        setPurgeId(null);
      } else toast.push("Delete failed", "error");
    } catch { toast.push("Delete failed", "error"); }
  };

  const bulkAction = async (action: "status" | "delete", status?: string) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/leads/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, status }) });
      if (!res.ok) throw new Error("bulk failed");
      await res.json();
      if (action === "delete") setVaultLeads((prev) => prev.filter((l) => !selectedIds.has(String(l.id))));
      else if (action === "status" && status) setVaultLeads((prev) => prev.map((l) => (selectedIds.has(String(l.id)) ? { ...l, status } : l)));
      setSelectedIds(new Set());
    } catch { toast.push("Bulk action failed", "error"); }
  };

  const staleCount = useMemo(() => vaultLeads.filter((l) => !l.audit || !l.websiteStatus || l.websiteStatus !== "audited").length, [vaultLeads]);

  const runBulkReaudit = async (idsOrAll: string[] | "stale") => {
    if (bulkReaudit.active) return;
    const ids = idsOrAll === "stale" ? undefined : idsOrAll;
    setBulkReaudit({ active: true, done: 0, total: 0, msg: "" });
    try {
      const res = await fetch("/api/leads/reaudit-bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids ?? [] }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Bulk re-audit failed"); }
      const reader = res.body?.getReader(); const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");
      let succeeded = 0, errored = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n\n")) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.replace("data: ", "");
          if (dataStr === "[DONE]") continue;
          try {
            const ev = JSON.parse(dataStr);
            if (ev.type === "lead" && ev.lead) {
              succeeded++;
              setVaultLeads((prev) => prev.map((l) => (String(l.id) === String(ev.lead.id) ? ev.lead : l)));
              setBulkReaudit({ active: true, done: (ev.index ?? 0) + 1, total: ev.total ?? 0, msg: ev.lead.name });
            } else if (ev.type === "progress") {
              setBulkReaudit((s) => ({ ...s, total: ev.total ?? s.total, msg: ev.msg ?? s.msg }));
            } else if (ev.type === "error") {
              errored++;
              setBulkReaudit((s) => ({ ...s, done: (ev.index ?? s.done) + 1, total: ev.total ?? s.total, msg: ev.msg ?? "Error" }));
            }
          } catch {}
        }
      }
      toast.push(`${succeeded} updated${errored ? `, ${errored} failed` : ""}`, errored > 0 ? "warn" : "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed", "error");
    } finally { setBulkReaudit({ active: false, done: 0, total: 0, msg: "" }); }
  };

  const copyAllEmails = () => {
    const ids = selectedIds.size > 0 ? selectedIds : new Set(filteredLeads.map((l) => String(l.id)));
    const list = vaultLeads.filter((l) => ids.has(String(l.id))).map((l) => l.email).filter((e) => e && e !== "No email found" && e !== "No Email Found");
    if (list.length === 0) { toast.push("No valid emails", "warn"); return; }
    navigator.clipboard.writeText(list.join(", "));
    toast.push(`Copied ${list.length}`, "success");
  };

  const exportCsv = async () => {
    const ids = selectedIds.size > 0 ? [...selectedIds] : filteredLeads.map((l) => String(l.id));
    if (ids.length === 0) { toast.push("Nothing to export", "warn"); return; }
    try {
      const res = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `customy-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.push(`Exported ${ids.length} lead(s)`, "success");
    } catch { toast.push("Export failed", "error"); }
  };

  const copyOutreach = () => {
    const ids = selectedIds.size > 0 ? selectedIds : new Set(filteredLeads.map((l) => String(l.id)));
    const chosen = vaultLeads.filter((l) => ids.has(String(l.id)));
    if (chosen.length === 0) { toast.push("No leads selected", "warn"); return; }
    const blocks = chosen.map((l, i) => {
      const r = waRecipient(l);
      const num = r ? `+${r}` : (l.phone && l.phone !== "No Phone" ? l.phone : "no number");
      return `${i + 1}. ${l.name}  (WhatsApp: ${num})\n${buildWhatsApp(l)}`;
    });
    navigator.clipboard.writeText(blocks.join("\n\n"));
    toast.push(`Copied ${chosen.length} message(s)`, "success");
  };

  const downloadPDF = (item: Lead, mode: "client" | "admin" = "admin") =>
    generatePdf(item, mode, { benchmark: peerBenchmark(item, vaultLeads) ?? undefined });

  const pushRecent = (entry: RecentSearch) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => !(r.niche === entry.niche && r.location === entry.location));
      const next = [entry, ...filtered].slice(0, 5);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // ---- scans (run in the parent so they survive the modal closing) ----
  const stopScan = () => scanAbort.current?.abort();

  const runHunter = async () => {
    if (!niche.trim() || !location.trim()) { toast.push("Industry and location required", "warn"); return; }
    setView(null);
    setScanKind("find"); setScanning(true); setLiveLeads([]); setLatestLead(null);
    setScanLogs([`Searching "${niche}" in ${location}`, `Plan: ${tier} (up to ${TIER_INFO[tier].deliver} leads)`]);
    pushRecent({ niche, location, tier, websiteFilter: findWebsiteFilter, ts: Date.now() });
    const ctrl = new AbortController(); scanAbort.current = ctrl;
    try {
      const response = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ niche, location, tier: tier.toUpperCase(), websiteFilter: findWebsiteFilter }), signal: ctrl.signal });
      const reader = response.body?.getReader(); const decoder = new TextDecoder();
      if (!reader) return;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n\n")) {
          if (!line.startsWith("data: ")) continue;
          const ds = line.slice(6);
          if (ds === "[DONE]") { setScanLogs((p) => [...p, "Done"]); continue; }
          try {
            const event = JSON.parse(ds);
            if (event.status === "result") {
              const lead = event.data as Lead;
              setLiveLeads((prev) => [lead, ...prev]); setLatestLead(lead);
              setScanLogs((p) => [...p, `FOUND  ${lead.name}  (presence ${lead.stats.score})`]);
            } else if (event.status === "auditing" || event.status === "hunting") {
              setScanLogs((p) => [...p, event.msg]);
            } else if (event.status === "error") {
              setScanLogs((p) => [...p, `ERROR  ${event.msg}`]);
            }
          } catch {}
        }
      }
      fetchVault();
    } catch (err) {
      if ((err as Error).name === "AbortError") setScanLogs((p) => [...p, "Stopped by you"]);
      else { setScanLogs((p) => [...p, "ERROR  Connection failure"]); toast.push("Scan failed", "error"); }
    } finally { setScanning(false); scanAbort.current = null; }
  };

  const runSweep = async (cfg: SweepConfigData) => {
    setView(null);
    setScanKind("sweep"); setScanning(true); setLiveLeads([]); setLatestLead(null);
    const total = cfg.niches.length * cfg.areas.length;
    setSweepProgress({ i: 0, total, found: 0, saved: 0, skipped: 0, noWeb: 0 });
    setScanLogs([`Sweep queued · ${cfg.niches.length} niches × ${cfg.areas.length} areas = ${total} searches`]);
    const ctrl = new AbortController(); scanAbort.current = ctrl;
    try {
      const res = await fetch("/api/sweep", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niches: cfg.niches, areas: cfg.areas, perCombo: cfg.perCombo, websiteFilter: cfg.websiteFilter, region: "Bali", maxLeads: 500 }),
        signal: ctrl.signal,
      });
      const reader = res.body?.getReader(); const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n\n")) {
          if (!line.startsWith("data: ")) continue;
          const s = line.slice(6);
          if (s === "[DONE]") continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(s); } catch { continue; }
          if (ev.type === "plan") {
            setSweepProgress((p) => ({ ...p, total: ev.combos as number }));
            setScanLogs((l) => [...l, `Scanning ${ev.combos} searches across Bali…`]);
          } else if (ev.type === "status") {
            setSweepProgress((p) => ({ ...p, i: (ev.i as number) + 1, total: ev.total as number }));
            setScanLogs((l) => [...l, `[${(ev.i as number) + 1}/${ev.total}] ${ev.msg}`]);
          } else if (ev.type === "result") {
            const lead = ev.data as Lead;
            setLiveLeads((prev) => [lead, ...prev].slice(0, 800)); setLatestLead(lead);
            setScanLogs((l) => [...l, `FOUND  ${lead.name}  (presence ${lead.stats.score})`]);
          } else if (ev.type === "tick") {
            setSweepProgress((p) => ({ ...p, found: ev.found as number, saved: ev.saved as number, skipped: ev.skipped as number, noWeb: ev.noWeb as number }));
          } else if (ev.type === "done") {
            setScanLogs((l) => [...l, `Done · ${ev.found} found (${ev.noWeb} no website), ${ev.saved} new, ${ev.skipped} skipped`]);
          } else if (ev.type === "error") {
            setScanLogs((l) => [...l, `ERROR  ${ev.msg}`]);
          }
        }
      }
      fetchVault();
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setScanLogs((l) => [...l, "ERROR  Sweep connection failed"]); toast.push("Sweep failed", "error"); }
      else setScanLogs((l) => [...l, "Stopped by you"]);
    } finally { setScanning(false); scanAbort.current = null; }
  };

  const navBtn = (v: View, label: React.ReactNode, badge?: number) => (
    <button
      onClick={() => setView((cur) => (cur === v ? null : v))}
      className={`px-3 sm:px-4 py-1.5 text-[13px] sm:text-sm font-medium rounded-sm transition-all flex items-center gap-1.5 sm:gap-2 ${view === v ? "bg-foreground text-(--primary-foreground)" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className={`text-[10px] tabular-nums rounded-sm px-1.5 py-0.5 ${view === v ? "bg-(--primary-foreground)/15" : "bg-muted text-muted-foreground"}`}>{badge}</span>
      )}
    </button>
  );

  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* full-page map canvas */}
      <MapCanvas leads={mapLeads} scanning={scanning} latest={latestLead} selectedId={openLead ? String(openLead.id) : null} onSelect={(l) => setOpenLead(l)} recenter={recenterKey} />

      {/* floating top bar (map stays interactive between the chips) */}
      <header className="fixed top-0 inset-x-0 z-40 pointer-events-none">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="pointer-events-auto flex items-center gap-2 bg-background/85 backdrop-blur border border-border rounded-md px-3 py-1.5 shadow-sm cursor-pointer" onClick={() => { setView(null); setRecenterKey((k) => k + 1); }} title="Recenter on Bali">
            <div className="relative w-7 h-7 shrink-0"><Image src="/customy_logo.png" alt="Customy" fill sizes="28px" className="object-contain" priority /></div>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">Scanmap</span>
            <span className="mono-meta hidden sm:inline">by <span className="brand-gradient font-semibold">Customy</span></span>
          </div>
          <nav className="pointer-events-auto flex items-center gap-1 bg-background/85 backdrop-blur border border-border rounded-md p-1 shadow-sm">
            {navBtn("sweep", <><span className="sm:hidden">Sweep</span><span className="hidden sm:inline">Bali Sweep</span></>)}
            {navBtn("find", "Find")}
            {navBtn("crm", "Library", stats.total)}
          </nav>
        </div>
      </header>

      {/* marker color legend (only meaningful once leads are on the map) */}
      {mapLeads.length > 0 && <MapLegend />}

      {/* a hint when the map is empty and nothing is scanning */}
      {!scanning && vaultLeads.length === 0 && !view && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center">
          <div className="pointer-events-auto panel px-6 py-5 text-center max-w-sm mx-4 shadow-lg">
            <div className="label-section mb-1">Your map is empty</div>
            <p className="text-sm text-muted-foreground mb-4">Run a Bali Sweep and watch leads drop onto the map as they&apos;re found.</p>
            <button onClick={() => setView("sweep")} className="btn btn-primary">Start a Bali sweep</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {view === "sweep" && (
        <Modal title="Bali Sweep" storageKey="sweep" onClose={() => setView(null)}>
          <SweepConfig onRun={runSweep} running={scanning && scanKind === "sweep"} />
        </Modal>
      )}

      {view === "find" && (
        <Modal title="Targeted search" storageKey="find" onClose={() => setView(null)}>
          <p className="text-sm text-muted-foreground mb-5">One niche, one place. For full coverage, run a Bali Sweep instead. Results drop onto the map.</p>
          <ScoringLegend />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <input value={niche} onChange={(e) => setNiche(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runHunter()} placeholder="Industry (e.g. yoga studio)" className="input" />
            <input value={location} onChange={(e) => setLocation(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runHunter()} placeholder="Location (e.g. Ubud, Bali)" className="input" />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(Object.keys(TIER_INFO) as Array<keyof typeof TIER_INFO>).map((p) => (
              <button key={p} onClick={() => setTier(p)} className={`p-3 rounded-sm text-left transition-all border ${tier === p ? "border-(--teal) bg-(--teal-soft) text-foreground" : "border-border bg-card text-foreground hover:border-(--border-strong)"}`}>
                <div className="text-sm font-semibold">{p}</div>
                <div className="text-xs text-muted-foreground">{TIER_INFO[p].sub}</div>
              </button>
            ))}
          </div>
          <div className="mb-4">
            <div className="label-overline mb-2">Which businesses to look for</div>
            <WebsiteFilterPicker value={findWebsiteFilter} onChange={setFindWebsiteFilter} />
          </div>
          <button onClick={runHunter} className="btn btn-primary w-full mb-5">Start search</button>
          {recent.length > 0 && (
            <div>
              <div className="label-overline mb-2">Recent</div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r, i) => (
                  <button key={i} onClick={() => { setNiche(r.niche); setLocation(r.location); setTier(r.tier as keyof typeof TIER_INFO); setFindWebsiteFilter(r.websiteFilter ?? "none_only"); }} className="chip chip-interactive">
                    {r.niche} <span style={{ color: "var(--tertiary-foreground)" }}>·</span> {r.location}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}

      {view === "crm" && (
        <Modal title="Library" wide storageKey="crm" onClose={() => setView(null)}>
          <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
            <StatCard label="Total leads" value={stats.total} sub="tap to reset" onClick={() => { setStatusFilter("ALL"); setQuickFilters(new Set()); }} active={statusFilter === "ALL" && quickFilters.size === 0} />
            <StatCard label="No website" value={stats.noWebsite} sub="tap to filter" onClick={() => { setStatusFilter("ALL"); setQuickFilters(new Set(["no_website"])); }} active={quickFilters.has("no_website")} />
            <StatCard label="Contacted" value={stats.contacted} tone="warn" onClick={() => { setStatusFilter("CONTACTED"); setQuickFilters(new Set()); }} active={statusFilter === "CONTACTED"} />
            <StatCard label="Won" value={stats.closed} tone="success" onClick={() => { setStatusFilter("CLOSED"); setQuickFilters(new Set()); }} active={statusFilter === "CLOSED"} />
            <StatCard label="Win rate" value={`${stats.rate}%`} />
            <StatCard label="Avg presence" value={stats.avgScore} sub={stats.topTech ? `Top stack: ${stats.topTech[0]} (${stats.topTech[1]})` : undefined} />
            <ScoreDistribution leads={vaultLeads} />
          </section>

          <OpportunityInsights leads={vaultLeads} />

          {staleCount > 0 && !bulkReaudit.active && (
            <section className="panel p-3 mb-4 flex items-center justify-between gap-3">
              <div className="text-sm"><span className="text-foreground font-medium">{staleCount} not fully audited</span><span className="text-muted-foreground"> · re-audit to fetch fresh presence data</span></div>
              <button onClick={() => runBulkReaudit("stale")} className="btn btn-primary btn-sm shrink-0">Re-audit all</button>
            </section>
          )}

          {bulkReaudit.active && (
            <section className="panel p-3 mb-4">
              <div className="flex items-center justify-between gap-3 mb-2 text-sm">
                <span className="text-foreground font-medium">Re-auditing</span>
                <span className="text-muted-foreground tabular-nums">{bulkReaudit.done}/{bulkReaudit.total}</span>
              </div>
              <div className="w-full h-0.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full transition-all duration-300" style={{ width: bulkReaudit.total ? `${(bulkReaudit.done / bulkReaudit.total) * 100}%` : "0%", background: "var(--teal)" }} />
              </div>
            </section>
          )}

          <section className="panel overflow-hidden">
            <CrmToolbar
              searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              techFilter={techFilter} setTechFilter={setTechFilter}
              sort={sort} setSort={setSort}
              techOptions={techOptions} counts={statusCounts} total={stats.total}
              quickFilters={quickFilters} toggleQuickFilter={toggleQuickFilter} clearQuickFilters={clearQuickFilters}
              filteredCount={filteredLeads.length} quickCounts={quickCounts}
              onExport={exportCsv} selectedCount={selectedIds.size}
            />

            {selectedIds.size > 0 && (
              <div className="px-6 py-3 bg-muted border-b border-border flex flex-wrap items-center gap-2 animate-in slide-in-from-top-2 duration-200">
                <span className="text-sm font-medium text-foreground mr-2">{selectedIds.size} selected</span>
                <span className="h-4 w-px bg-border" />
                {STATUS_OPTIONS.map((s) => (<button key={s} onClick={() => bulkAction("status", s)} className="btn btn-secondary btn-sm">{s.charAt(0) + s.slice(1).toLowerCase()}</button>))}
                <button onClick={copyAllEmails} className="btn btn-secondary btn-sm">Copy emails</button>
                <button onClick={copyOutreach} className="btn btn-secondary btn-sm">Copy messages</button>
                <button onClick={() => runBulkReaudit([...selectedIds])} disabled={bulkReaudit.active} className="btn btn-secondary btn-sm">Re-audit</button>
                <button onClick={() => { if (confirm(`Delete ${selectedIds.size} lead(s)?`)) bulkAction("delete"); }} className="btn btn-danger btn-sm ml-auto">Delete</button>
                <button onClick={() => setSelectedIds(new Set())} className="btn btn-ghost btn-sm">Clear</button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[820px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-6 py-3 w-10"><input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="accent-(--teal) cursor-pointer" /></th>
                    <th className="px-4 py-3 label-overline">Lead</th>
                    <th className="px-4 py-3 label-overline">Stack</th>
                    <th className="px-4 py-3 label-overline">Presence</th>
                    <th className="px-4 py-3 label-overline">Status</th>
                    <th className="px-4 py-3 text-right label-overline">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vaultLoading && Array.from({ length: 4 }).map((_, i) => (
                    <tr key={`skel-${i}`} className="border-b border-border">
                      <td className="px-6 py-4"><div className="w-4 h-4 bg-muted animate-pulse rounded-sm" /></td>
                      <td className="px-4 py-4"><div className="h-4 w-48 bg-muted animate-pulse rounded mb-2" /><div className="h-3 w-32 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-4"><div className="h-5 w-16 bg-muted animate-pulse rounded-full" /></td>
                      <td className="px-4 py-4"><div className="h-4 w-10 bg-muted animate-pulse rounded" /></td>
                      <td className="px-4 py-4"><div className="h-6 w-20 bg-muted animate-pulse rounded-full" /></td>
                      <td className="px-4 py-4"><div className="h-7 w-24 bg-muted animate-pulse rounded-full ml-auto" /></td>
                    </tr>
                  ))}
                  {!vaultLoading && filteredLeads.length === 0 && (
                    <tr><td colSpan={6} className="p-12 text-center"><p className="text-sm text-muted-foreground">{vaultLeads.length === 0 ? "Nothing here yet. Run a Bali Sweep to fill your library." : "No leads match these filters."}</p></td></tr>
                  )}
                  {!vaultLoading && filteredLeads.map((lead) => {
                    const id = String(lead.id);
                    const sel = selectedIds.has(id);
                    const status = lead.status || "NEW";
                    const score = lead.stats?.score ?? 0;
                    const scoreColor = score >= 70 ? "text-[#0E9F6E]" : score >= 40 ? "text-[#C2710C]" : "text-[#DC2626]";
                    return (
                      <tr key={lead.id} className={`border-b border-border transition-colors cursor-pointer ${sel ? "bg-(--primary-soft)" : "hover:bg-muted"}`} onClick={() => setOpenLead(lead)}>
                        <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel} onChange={() => toggleOne(id)} className="accent-(--teal) cursor-pointer" /></td>
                        <td className="px-4 py-4">
                          <div className="font-medium text-foreground truncate max-w-[280px]">{lead.name}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[280px]">{lead.category ? `${lead.category} · ` : ""}{lead.email}</div>
                          {lead.notes && <div className="text-xs mt-1 italic truncate max-w-[280px]" style={{ color: "var(--tertiary-foreground)" }}>{lead.notes}</div>}
                        </td>
                        <td className="px-4 py-4">{lead.tech ? <span className="chip">{lead.tech}</span> : <span className="text-muted-foreground text-xs">none</span>}</td>
                        <td className={`px-4 py-4 text-base font-semibold tabular-nums ${scoreColor}`}>{score}</td>
                        <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <select value={status} onChange={(e) => commitStatusChange(id, e.target.value)} className="select">
                            {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0) + o.slice(1).toLowerCase()}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => handleQuickStrike(lead)} className="btn btn-secondary btn-sm">Email</button>
                            <button onClick={() => setOpenLead(lead)} className="btn btn-ghost btn-sm">Open</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </Modal>
      )}

      {/* floating scan status over the map */}
      {scanKind && (
        <ScanStatus
          kind={scanKind}
          scanning={scanning}
          logs={scanLogs}
          progress={sweepProgress}
          found={liveLeads.length}
          onStop={stopScan}
          onDismiss={() => { setScanKind(null); setLiveLeads([]); setLatestLead(null); }}
          onViewLibrary={() => setView("crm")}
        />
      )}

      <LeadDetail
        lead={openLead}
        onClose={() => setOpenLead(null)}
        onStatusChange={commitStatusChange}
        onNotesSaved={onNotesSaved}
        onPurge={(id) => setPurgeId(id)}
        onDownloadPDF={downloadPDF}
        onQuickStrike={handleQuickStrike}
        onLeadRefreshed={(refreshed) => { setVaultLeads((prev) => prev.map((l) => (String(l.id) === String(refreshed.id) ? refreshed : l))); setOpenLead(refreshed); }}
      />

      {purgeId && (
        <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setPurgeId(null)}>
          <div className="panel max-w-sm w-full p-6 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-1">Delete this lead?</h3>
            <p className="text-sm text-muted-foreground mb-5">This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPurgeId(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={executePurge} className="btn" style={{ background: "var(--bad)", color: "#fff" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, tone, onClick, active }: { label: string; value: React.ReactNode; sub?: string; tone?: "success" | "warn"; onClick?: () => void; active?: boolean }) {
  const valueColor = tone === "success" ? "text-[#0B7A52]" : tone === "warn" ? "text-[#C2710C]" : "text-foreground";
  return (
    <div onClick={onClick} className={`card-flat p-4 ${onClick ? "cursor-pointer transition-colors hover:border-(--border-strong)" : ""} ${active ? "border-(--teal) bg-(--teal-soft)" : ""}`}>
      <div className="label-overline mb-1">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

export default function CommandCenter() {
  return (
    <ToastProvider>
      <CommandCenterInner />
    </ToastProvider>
  );
}
