"use client"

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { LeadCard } from '@/components/LeadCard';
import { Lead, LeadStatus, STATUS_OPTIONS } from '@/lib/types';
import jsPDF from 'jspdf';
import { ToastProvider, useToast } from '@/components/Toast';
import { LeadDetail } from '@/components/LeadDetail';
import { CrmToolbar, SortKey } from '@/components/CrmToolbar';

const TIER_INFO: Record<string, { scan: number; deliver: number; tag: string }> = {
  FREE:    { scan: 10,  deliver: 3,   tag: "Recon" },
  PRO:     { scan: 40,  deliver: 15,  tag: "Strike" },
  PREMIUM: { scan: 150, deliver: 150, tag: "Saturation" },
};

const RECENT_KEY = "cc_recent_searches_v1";

interface RecentSearch { niche: string; location: string; tier: string; ts: number; }

const ScanTerminal = ({ logs, isScanning, leadCount, target }: { logs: string[], isScanning: boolean, leadCount: number, target: number }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const progress = Math.min((leadCount / Math.max(target, 1)) * 100, 100);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  if (logs.length === 0 && !isScanning) return null;

  return (
    <div className="card-bento p-0 overflow-hidden border-primary/30 mb-6 bg-black/80 backdrop-blur-md animate-in slide-in-from-top-4 duration-500">
      <div className="bg-zinc-900/80 px-4 py-2 border-b border-border flex justify-between items-center">
        <span className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-orange-500 animate-pulse' : 'bg-emerald-500'}`}></span>
          {isScanning ? 'LIVE INFILTRATION FEED' : 'SCAN COMPLETE'}
        </span>
        <span className="text-[9px] font-mono text-zinc-600 uppercase">
          ASSETS: {leadCount.toString().padStart(2, '0')} / {target.toString().padStart(2, '0')}
        </span>
      </div>
      {isScanning && (
        <div className="w-full h-1 bg-zinc-900 relative">
          <div className="absolute top-0 left-0 h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_10px_var(--primary)]" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="h-40 overflow-y-auto p-4 font-mono text-[10px] space-y-1 scrollbar-hide">
        {logs.map((log, i) => (
          <div key={i} className={`flex gap-3 ${log.includes('FOUND') ? 'text-emerald-500 font-bold' : log.includes('ERROR') ? 'text-rose-500' : 'text-zinc-500'}`}>
            <span className="opacity-30 select-none">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
            <span className="tracking-tighter">{log}</span>
          </div>
        ))}
        {isScanning && (
          <div className="text-primary animate-pulse flex gap-3">
             <span className="opacity-30">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
             <span>{`> DECRYPTING_PACKETS...`}</span>
          </div>
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
};

function ScoreDistribution({ leads }: { leads: Lead[] }) {
  const buckets = useMemo(() => {
    const b = [0, 0, 0, 0, 0]; // 0-19, 20-39, 40-59, 60-79, 80-100
    for (const l of leads) {
      const s = l.stats?.score ?? 0;
      const i = Math.min(Math.floor(s / 20), 4);
      b[i]++;
    }
    return b;
  }, [leads]);
  const max = Math.max(1, ...buckets);
  const labels = ["0-19", "20-39", "40-59", "60-79", "80+"];
  const colors = ["bg-rose-600", "bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-400"];

  return (
    <div className="card-bento p-4 col-span-2 md:col-span-2">
      <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-3">
        Score Distribution
      </div>
      <div className="flex items-end gap-2 h-16">
        {buckets.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className={`w-full ${colors[i]} transition-all`} style={{ height: `${(count / max) * 100}%`, minHeight: count > 0 ? '4px' : '0' }} title={`${count} target(s)`} />
            <div className="text-[8px] font-mono text-zinc-600">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandCenterInner() {
  const [view, setView] = useState<'hunter' | 'crm'>('hunter');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [vaultLeads, setVaultLeads] = useState<Lead[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [tier, setTier] = useState('FREE');
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | LeadStatus>("ALL");
  const [techFilter, setTechFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch {}
  }, []);

  const fetchVault = useCallback(() => {
    setVaultLoading(true);
    fetch('/api/leads')
      .then(res => res.json())
      .then(data => setVaultLeads(data))
      .catch(() => toast.push("Failed to load vault.", "error"))
      .finally(() => setVaultLoading(false));
  }, [toast]);

  useEffect(() => {
    if (view === 'crm') fetchVault();
  }, [view, fetchVault]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && view === 'crm') {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('input[placeholder^="SEARCH"]');
        el?.focus();
      }
      if (e.key === 'Escape') {
        setPurgeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  const rebootSystem = () => window.location.reload();

  const stats = useMemo(() => {
    const total = vaultLeads.length;
    const closed = vaultLeads.filter(l => l.status === "CLOSED").length;
    const contacted = vaultLeads.filter(l => l.status === "CONTACTED").length;
    const rate = total > 0 ? Math.round((closed / total) * 100) : 0;
    const avgScore = total > 0 ? Math.round(vaultLeads.reduce((s, l) => s + (l.stats?.score ?? 0), 0) / total) : 0;
    const techMap: Record<string, number> = {};
    for (const l of vaultLeads) {
      const k = l.tech || 'Unknown';
      techMap[k] = (techMap[k] || 0) + 1;
    }
    const topTech = Object.entries(techMap).sort((a, b) => b[1] - a[1])[0];
    return { total, closed, contacted, rate, avgScore, topTech };
  }, [vaultLeads]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STATUS_OPTIONS) c[s] = 0;
    for (const l of vaultLeads) {
      const s = l.status || "NEW";
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  }, [vaultLeads]);

  const techOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of vaultLeads) if (l.tech) set.add(l.tech);
    return [...set].sort();
  }, [vaultLeads]);

  const filteredLeads = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    let out = vaultLeads.filter(l => {
      if (statusFilter !== "ALL" && (l.status || "NEW") !== statusFilter) return false;
      if (techFilter !== "ALL" && l.tech !== techFilter) return false;
      if (q) {
        const hay = `${l.name} ${l.email ?? ""} ${l.tech ?? ""} ${l.address ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "score_desc": return (b.stats?.score ?? 0) - (a.stats?.score ?? 0);
        case "score_asc":  return (a.stats?.score ?? 0) - (b.stats?.score ?? 0);
        case "name_asc":   return a.name.localeCompare(b.name);
        case "date_desc":
        default: return (b.date ?? "").localeCompare(a.date ?? "");
      }
    });
    return out;
  }, [vaultLeads, searchTerm, statusFilter, techFilter, sort]);

  const allFilteredSelected = filteredLeads.length > 0 && filteredLeads.every(l => selectedIds.has(String(l.id)));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map(l => String(l.id))));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitStatusChange = async (id: string, nextStatus: string) => {
    try {
      const response = await fetch(`/api/leads/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStatus: nextStatus })
      });
      if (response.ok) {
        setVaultLeads(prev => prev.map(l =>
          String(l.id) === String(id) ? { ...l, status: nextStatus } : l
        ));
        if (openLead && String(openLead.id) === String(id)) {
          setOpenLead({ ...openLead, status: nextStatus });
        }
        toast.push(`Status set: ${nextStatus}`, "success");
      } else {
        toast.push("Status sync failed.", "error");
      }
    } catch {
      toast.push("Status sync failed.", "error");
    }
  };

  const onNotesSaved = (id: string, notes: string) => {
    setVaultLeads(prev => prev.map(l => String(l.id) === id ? { ...l, notes } : l));
  };

  const handleQuickStrike = (lead: Lead) => {
    if (!lead.email || lead.email === "No Email Found") {
      toast.push("No comms channel found for this target.", "warn");
      return;
    }
    const subject = encodeURIComponent(`Partnership Opportunity: ${lead.name} x [Your Agency]`);
    const body = encodeURIComponent(`Hi Team ${lead.name},\n\nI was analyzing your digital presence and noticed potential optimization in your ${lead.tech} stack.\n\n${lead.pitch}\n\nWould you be open to a 5-minute debrief?\n\nBest,\n[Your Name]`);
    window.location.href = `mailto:${lead.email}?subject=${subject}&body=${body}`;
    toast.push(`Mail client opened for ${lead.name}.`, "info");
  };

  const executePurge = async () => {
    if (!purgeId) return;
    try {
      const response = await fetch(`/api/leads/${purgeId}`, { method: 'DELETE' });
      if (response.ok) {
        setVaultLeads(prev => prev.filter(l => String(l.id) !== String(purgeId)));
        if (openLead && String(openLead.id) === purgeId) setOpenLead(null);
        toast.push("Target purged from vault.", "success");
        setPurgeId(null);
      } else {
        toast.push("Purge failed.", "error");
      }
    } catch {
      toast.push("Purge system failure.", "error");
    }
  };

  const bulkAction = async (action: 'status' | 'delete', status?: string) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/leads/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids, status }),
      });
      if (!res.ok) throw new Error('bulk failed');
      const json = await res.json();
      if (action === 'delete') {
        setVaultLeads(prev => prev.filter(l => !selectedIds.has(String(l.id))));
        toast.push(`Purged ${json.count} target(s).`, "success");
      } else if (action === 'status' && status) {
        setVaultLeads(prev => prev.map(l => selectedIds.has(String(l.id)) ? { ...l, status } : l));
        toast.push(`Updated ${json.count} target(s) → ${status}.`, "success");
      }
      setSelectedIds(new Set());
    } catch {
      toast.push("Bulk operation failed.", "error");
    }
  };

  const copyAllEmails = () => {
    const ids = selectedIds.size > 0 ? selectedIds : new Set(filteredLeads.map(l => String(l.id)));
    const list = vaultLeads
      .filter(l => ids.has(String(l.id)))
      .map(l => l.email)
      .filter(e => e && e !== "No Email Found");
    if (list.length === 0) {
      toast.push("No valid emails in selection.", "warn");
      return;
    }
    navigator.clipboard.writeText(list.join(", "));
    toast.push(`Copied ${list.length} email(s).`, "success");
  };

  const downloadPDF = (item: Lead) => {
    const doc = new jsPDF();
    const W = 210, M = 20;
    // Background
    doc.setFillColor(5, 5, 5);
    doc.rect(0, 0, W, 297, 'F');
    // Header bar
    doc.setFillColor(249, 115, 22);
    doc.rect(0, 0, W, 4, 'F');
    // Title
    doc.setTextColor(249, 115, 22);
    doc.setFont("courier", "bold");
    doc.setFontSize(10);
    doc.text("DIGITAL AUDIT // COMMAND CENTER", M, 18);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    const safeName = item.name.toUpperCase();
    const titleLines = doc.splitTextToSize(safeName, W - 2 * M);
    doc.text(titleLines, M, 32);
    let y = 32 + titleLines.length * 8;

    // Score block
    doc.setDrawColor(40, 40, 40);
    doc.setFillColor(15, 15, 15);
    doc.rect(M, y, W - 2 * M, 28, 'F');
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(8);
    doc.text("EFFICIENCY SCORE", M + 4, y + 8);
    doc.setFontSize(28);
    const scoreColor: [number, number, number] = item.stats.score >= 70 ? [16, 185, 129] : item.stats.score >= 40 ? [249, 115, 22] : [225, 29, 72];
    doc.setTextColor(...scoreColor);
    doc.text(`${item.stats.score}%`, M + 4, y + 22);
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(8);
    doc.text(`RISK: ${item.stats.riskLevel.toUpperCase()}`, M + 60, y + 8);
    doc.text(`STACK: ${item.tech.toUpperCase()}`, M + 60, y + 14);
    doc.text(`STATUS: ${(item.status ?? 'NEW')}`, M + 60, y + 20);
    doc.text(`RATING: ${item.rating || 'N/A'}`, M + 130, y + 8);
    doc.text(`REVIEWS: ${item.reviews || '0'}`, M + 130, y + 14);
    doc.text(`DATE: ${item.date ?? new Date().toISOString().split('T')[0]}`, M + 130, y + 20);
    y += 36;

    // Contact block
    doc.setTextColor(249, 115, 22);
    doc.setFontSize(10);
    doc.text("CONTACT INTELLIGENCE", M, y);
    y += 6;
    doc.setDrawColor(40, 40, 40);
    doc.line(M, y, W - M, y);
    y += 6;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    const fields: [string, string][] = [
      ["EMAIL", item.email || "—"],
      ["PHONE", item.phone || "—"],
      ["URL", item.url || "—"],
      ["ADDRESS", item.address || "—"],
    ];
    for (const [k, v] of fields) {
      doc.setTextColor(120, 120, 120);
      doc.text(k, M, y);
      doc.setTextColor(255, 255, 255);
      const lines = doc.splitTextToSize(v, W - 2 * M - 30);
      doc.text(lines, M + 30, y);
      y += Math.max(6, lines.length * 5);
    }
    y += 4;

    // Pitch
    doc.setTextColor(249, 115, 22);
    doc.setFontSize(10);
    doc.text("RECOMMENDED PITCH", M, y);
    y += 6;
    doc.line(M, y, W - M, y);
    y += 6;
    doc.setTextColor(200, 200, 200);
    doc.setFontSize(10);
    const pitchLines = doc.splitTextToSize(item.pitch, W - 2 * M);
    doc.text(pitchLines, M, y);
    y += pitchLines.length * 5 + 6;

    // Notes
    if (item.notes && item.notes.trim()) {
      doc.setTextColor(249, 115, 22);
      doc.setFontSize(10);
      doc.text("FIELD NOTES", M, y);
      y += 6;
      doc.line(M, y, W - M, y);
      y += 6;
      doc.setTextColor(200, 200, 200);
      doc.setFontSize(9);
      const noteLines = doc.splitTextToSize(item.notes, W - 2 * M);
      doc.text(noteLines, M, y);
    }

    // Footer
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(7);
    doc.text(`COMMAND CENTER // ${new Date().toISOString()}`, M, 290);

    doc.save(`AUDIT_${item.name.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`);
  };

  const pushRecent = (entry: RecentSearch) => {
    setRecent(prev => {
      const filtered = prev.filter(r => !(r.niche === entry.niche && r.location === entry.location));
      const next = [entry, ...filtered].slice(0, 5);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const runHunter = async () => {
    if (!niche.trim() || !location.trim()) {
      toast.push("Coordinates required (niche + location).", "warn");
      return;
    }
    setLeads([]);
    setScanLogs([
      "[INIT] Establishing connection to satellite nodes...",
      `[CONFIG] Tier=${tier} · Depth=${TIER_INFO[tier].scan} · Deliver=${TIER_INFO[tier].deliver}`,
      "[AUTH] Tactical credentials verified.",
    ]);
    setIsScanning(true);
    pushRecent({ niche, location, tier, ts: Date.now() });
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche, location, tier }),
      });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');
        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '');
            if (dataStr === '[DONE]') {
              setScanLogs(prev => [...prev, "[SUCCESS] Acquisition protocol complete."]);
              return;
            }
            try {
              const event = JSON.parse(dataStr);
              if (event.status === 'result') {
                setLeads(prev => [event.data, ...prev]);
                setScanLogs(prev => [...prev, `[FOUND] Target: ${event.data.name.toUpperCase()} identified.`]);
              } else if (event.status === 'error') {
                setScanLogs(prev => [...prev, `[ERROR] ${event.msg}`]);
              }
            } catch {}
          }
        });
      }
    } catch {
      setScanLogs(prev => [...prev, "[ERROR] Connection failure during uplink."]);
      toast.push("Connection failure during scan.", "error");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="app-container min-h-screen select-none">
      <header className="flex justify-between items-center mb-10 pb-8 border-b border-border">
        <div onClick={rebootSystem} className="logo-link flex items-center gap-4 group cursor-pointer">
          <div className="w-12 h-12 bg-primary flex items-center justify-center text-xl font-black italic text-primary-foreground shadow-[0_0_20px_rgba(249,115,22,0.3)] transition-transform group-hover:scale-110">AF</div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter text-white uppercase leading-none group-hover:text-primary transition-colors">Command <span className="text-primary italic">Center</span></h1>
            <p className="text-[9px] text-muted-foreground font-mono uppercase tracking-[0.3em] mt-1 group-hover:text-white">v12.0 // Click to reboot</p>
          </div>
        </div>
        <nav className="flex gap-8 items-center">
          <button onClick={() => setView('hunter')} className={`tab-btn pb-2 cursor-pointer ${view === 'hunter' ? 'active' : ''}`}>Hunter</button>
          <button onClick={() => setView('crm')} className={`tab-btn pb-2 cursor-pointer ${view === 'crm' ? 'active' : ''}`}>
            Secured Vault
            {stats.total > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-primary/20 text-primary text-[9px] font-mono">{stats.total}</span>
            )}
          </button>
        </nav>
      </header>

      {view === 'hunter' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="lg:col-span-4 space-y-6">
            <div className="card-bento p-4">
              <div className="text-[10px] font-black text-muted-foreground tracking-widest uppercase mb-4">Tactical Plan Allocation</div>
              <div className="grid grid-cols-3 gap-2">
                {(['FREE', 'PRO', 'PREMIUM'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setTier(p)}
                    className={`tier-btn p-3 bg-zinc-900/50 border text-center transition-all duration-200 hover:border-primary ${tier === p ? 'border-primary bg-primary/10' : 'border-border'}`}
                  >
                    <div className={`text-xs font-bold uppercase ${tier === p ? 'text-primary' : 'text-white'}`}>{p}</div>
                    <div className="text-[8px] font-mono text-zinc-500 mt-1">{TIER_INFO[p].deliver} leads</div>
                  </button>
                ))}
              </div>
              <div className="mt-3 text-[9px] font-mono text-zinc-500 leading-relaxed">
                <span className="text-primary">{TIER_INFO[tier].tag}:</span> Scans {TIER_INFO[tier].scan} entries, returns up to {TIER_INFO[tier].deliver}.
              </div>
            </div>

            <div className="card-bento p-6">
              <label className="text-[10px] font-black text-muted-foreground uppercase block mb-2">Target Parameters</label>
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isScanning && runHunter()}
                placeholder="NICHE SECTOR (e.g. sushi, dentist, gym)"
                className="input-field w-full mb-4 uppercase text-sm"
                disabled={isScanning}
              />
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isScanning && runHunter()}
                placeholder="LOCATION CODE (e.g. Bali, Chicago)"
                className="input-field w-full mb-6 uppercase text-sm"
                disabled={isScanning}
              />
              <button onClick={runHunter} disabled={isScanning} className="btn-primary w-full py-4 text-xs cursor-pointer disabled:opacity-50 disabled:cursor-wait">
                {isScanning ? 'INFILTRATING...' : 'EXECUTE ACQUISITION'}
              </button>
            </div>

            {recent.length > 0 && (
              <div className="card-bento p-4">
                <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-3">Recent Coordinates</div>
                <div className="space-y-1">
                  {recent.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => { setNiche(r.niche); setLocation(r.location); setTier(r.tier); }}
                      disabled={isScanning}
                      className="w-full text-left p-2 bg-black/40 hover:bg-primary/10 hover:border-primary border border-transparent transition-all cursor-pointer disabled:cursor-not-allowed"
                    >
                      <div className="text-[10px] font-mono text-white uppercase truncate">
                        {r.niche} <span className="text-zinc-600">/</span> {r.location}
                      </div>
                      <div className="text-[8px] font-mono text-zinc-600 mt-0.5">{r.tier}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div id="console" className="h-44 overflow-y-auto border border-border bg-black/50 p-4 font-mono text-[10px] text-muted-foreground shadow-inner">
              <p className="mb-1 text-zinc-500"># SYSTEM_READY_V12.0</p>
              <p className="text-zinc-500">{`> ARCHITECTURE: NEXT_SCRAPER_V1`}</p>
              <p className="text-zinc-500">{`> STREAM: SSE_DUPLEX`}</p>
              <p className="text-zinc-500">{`> STATUS: ${isScanning ? 'BUSY' : 'IDLE'}`}</p>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-4">
            <ScanTerminal logs={scanLogs} isScanning={isScanning} leadCount={leads.length} target={TIER_INFO[tier].deliver} />
            <div className="space-y-4">
              {leads.map((lead) => (
                <LeadCard key={lead.id} item={lead} downloadPDF={downloadPDF} />
              ))}
              {leads.length === 0 && !isScanning && (
                <div className="border-2 border-dashed border-border p-12 text-center">
                  <p className="font-black uppercase tracking-[0.5em] text-zinc-700 mb-4">Awaiting Coordinates</p>
                  <p className="text-[10px] font-mono text-zinc-600 mb-6">Enter a niche and location to begin reconnaissance.</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-2xl mx-auto">
                    {[
                      { n: "dentist", l: "Austin" },
                      { n: "yoga studio", l: "Bali" },
                      { n: "law firm", l: "Chicago" },
                    ].map((p) => (
                      <button
                        key={p.n}
                        onClick={() => { setNiche(p.n); setLocation(p.l); }}
                        className="p-3 border border-zinc-800 hover:border-primary hover:bg-primary/5 transition-all cursor-pointer text-left"
                      >
                        <div className="text-[10px] font-mono text-white uppercase">{p.n}</div>
                        <div className="text-[9px] font-mono text-zinc-600">in {p.l}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="card-bento p-4 border-t-zinc-500">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Total Assets</div>
              <div className="text-2xl font-black text-white font-mono">{stats.total}</div>
            </div>
            <div className="card-bento p-4 border-t-amber-500">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Engaged</div>
              <div className="text-2xl font-black text-amber-400 font-mono">{stats.contacted}</div>
            </div>
            <div className="card-bento p-4 border-t-emerald-500">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Acquired</div>
              <div className="text-2xl font-black text-emerald-500 font-mono">{stats.closed}</div>
            </div>
            <div className="card-bento p-4 border-t-orange-600">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Win Rate</div>
              <div className="text-2xl font-black text-white font-mono">{stats.rate}%</div>
            </div>
            <div className="card-bento p-4 border-t-primary">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">Avg Score</div>
              <div className="text-2xl font-black text-primary font-mono">{stats.avgScore}</div>
              <div className="text-[8px] font-mono text-zinc-600 mt-1">
                Top: {stats.topTech ? `${stats.topTech[0]} (${stats.topTech[1]})` : '—'}
              </div>
            </div>
            <ScoreDistribution leads={vaultLeads} />
          </div>

          <div className="w-full card-bento p-0 overflow-visible relative">
            <CrmToolbar
              searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              techFilter={techFilter} setTechFilter={setTechFilter}
              sort={sort} setSort={setSort}
              techOptions={techOptions}
              counts={statusCounts}
              total={stats.total}
            />

            {selectedIds.size > 0 && (
              <div className="px-6 py-3 bg-primary/10 border-b border-primary/30 flex flex-wrap items-center gap-3 animate-in slide-in-from-top-2 duration-200">
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                  {selectedIds.size} selected
                </span>
                <span className="h-4 w-px bg-zinc-700" />
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => bulkAction('status', s)}
                    className="text-[9px] font-black uppercase px-2 py-1.5 bg-zinc-900 hover:bg-primary hover:text-black border border-zinc-800 transition-all cursor-pointer"
                  >
                    Set: {s}
                  </button>
                ))}
                <button
                  onClick={copyAllEmails}
                  className="text-[9px] font-black uppercase px-2 py-1.5 bg-zinc-900 hover:bg-white hover:text-black border border-zinc-800 transition-all cursor-pointer"
                >
                  Copy Emails
                </button>
                <button
                  onClick={() => { if (confirm(`Purge ${selectedIds.size} target(s)?`)) bulkAction('delete'); }}
                  className="text-[9px] font-black uppercase px-2 py-1.5 border border-rose-700 text-rose-400 hover:bg-rose-600 hover:text-white transition-all cursor-pointer ml-auto"
                >
                  Purge Selection
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-[9px] font-black uppercase text-zinc-500 hover:text-white cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono min-w-[900px]">
                <thead className="bg-black text-muted-foreground text-[11px] uppercase border-b border-border sticky top-0">
                  <tr>
                    <th className="p-5 font-black w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                        className="accent-primary cursor-pointer"
                        aria-label="Select all"
                      />
                    </th>
                    <th className="p-5 font-black">Target</th>
                    <th className="p-5 font-black">Tech</th>
                    <th className="p-5 font-black">Score</th>
                    <th className="p-5 font-black">Status</th>
                    <th className="p-5 font-black text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-[12px] text-zinc-400">
                  {vaultLoading && (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={`skel-${i}`} className="border-b border-border">
                        <td className="p-5"><div className="w-4 h-4 bg-zinc-900 animate-pulse" /></td>
                        <td className="p-5"><div className="h-4 w-48 bg-zinc-900 animate-pulse mb-2" /><div className="h-3 w-32 bg-zinc-900 animate-pulse" /></td>
                        <td className="p-5"><div className="h-4 w-16 bg-zinc-900 animate-pulse" /></td>
                        <td className="p-5"><div className="h-4 w-10 bg-zinc-900 animate-pulse" /></td>
                        <td className="p-5"><div className="h-6 w-20 bg-zinc-900 animate-pulse" /></td>
                        <td className="p-5"><div className="h-6 w-24 bg-zinc-900 animate-pulse ml-auto" /></td>
                      </tr>
                    ))
                  )}
                  {!vaultLoading && filteredLeads.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-12 text-center">
                        <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
                          {vaultLeads.length === 0 ? "Vault is empty. Run a scan from the Hunter tab." : "No targets match the current filters."}
                        </div>
                      </td>
                    </tr>
                  )}
                  {!vaultLoading && filteredLeads.map((lead) => {
                    const id = String(lead.id);
                    const sel = selectedIds.has(id);
                    const status = lead.status || "NEW";
                    const sCls =
                      status === "CLOSED" ? "border-emerald-500 text-emerald-500 bg-emerald-500/10" :
                      status === "REJECTED" ? "border-rose-500 text-rose-500 bg-rose-500/10" :
                      status === "CONTACTED" ? "border-amber-500 text-amber-400 bg-amber-500/10" :
                      "border-primary text-primary bg-primary/10";
                    const score = lead.stats?.score ?? 0;
                    const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-primary" : "text-rose-500";
                    return (
                      <tr
                        key={lead.id}
                        className={`border-b border-border transition-colors group cursor-pointer ${sel ? 'bg-primary/5' : 'hover:bg-white/[0.02]'}`}
                        onClick={() => setOpenLead(lead)}
                      >
                        <td className="p-5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={sel}
                            onChange={() => toggleOne(id)}
                            className="accent-primary cursor-pointer"
                            aria-label={`Select ${lead.name}`}
                          />
                        </td>
                        <td className="p-5">
                          <div className="text-white font-black uppercase tracking-tight group-hover:text-primary transition-colors truncate max-w-[260px]">{lead.name}</div>
                          <div className="text-[9px] text-zinc-500 mt-0.5 truncate max-w-[260px]">{lead.email}</div>
                          {lead.notes && (
                            <div className="text-[9px] text-zinc-600 mt-1 italic truncate max-w-[260px]">📝 {lead.notes}</div>
                          )}
                        </td>
                        <td className="p-5">
                          <span className="bg-zinc-800 text-zinc-400 px-2 py-1 text-[9px] font-mono">{lead.tech || '—'}</span>
                        </td>
                        <td className={`p-5 font-black ${scoreColor}`}>{score}%</td>
                        <td className="p-5" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={status}
                            onChange={(e) => commitStatusChange(id, e.target.value)}
                            className={`status-badge appearance-none ${sCls} pr-6 cursor-pointer`}
                          >
                            {STATUS_OPTIONS.map(o => <option key={o} value={o} className="bg-black text-white">{o}</option>)}
                          </select>
                        </td>
                        <td className="p-5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleQuickStrike(lead)}
                              className="bg-white text-black px-3 py-1.5 text-[9px] font-black uppercase hover:bg-primary transition-all cursor-pointer flex items-center gap-1.5"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                              Email
                            </button>
                            <button
                              onClick={() => setOpenLead(lead)}
                              className="bg-zinc-900 border border-zinc-800 text-zinc-400 px-3 py-1.5 text-[9px] font-black uppercase hover:text-white hover:border-white transition-all cursor-pointer"
                            >
                              Open
                            </button>
                            <button onClick={() => setPurgeId(id)} className="text-zinc-600 hover:text-rose-600 transition-colors uppercase font-black text-[10px] p-2 cursor-pointer">
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <LeadDetail
        lead={openLead}
        onClose={() => setOpenLead(null)}
        onStatusChange={commitStatusChange}
        onNotesSaved={onNotesSaved}
        onPurge={(id) => setPurgeId(id)}
        onDownloadPDF={downloadPDF}
        onQuickStrike={handleQuickStrike}
      />

      {purgeId && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="card-bento max-w-sm w-full p-8 border-rose-600 border-t-4 animate-in zoom-in duration-200">
            <h3 className="text-xl font-black text-white uppercase tracking-tighter mb-2 text-rose-500">Confirm Purge</h3>
            <p className="text-muted-foreground text-xs font-mono mb-8 leading-relaxed">WARNING: Irreversible de-listing of target.</p>
            <div className="flex gap-4">
              <button onClick={executePurge} className="flex-1 bg-rose-600 text-white font-black py-4 text-[10px] uppercase hover:bg-white hover:text-black transition-all cursor-pointer">Execute</button>
              <button onClick={() => setPurgeId(null)} className="flex-1 border border-border text-muted-foreground font-black py-4 text-[10px] uppercase hover:text-white transition-all cursor-pointer">Abort</button>
            </div>
          </div>
        </div>
      )}
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
