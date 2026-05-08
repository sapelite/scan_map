"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LeadCard } from "@/components/LeadCard";
import { Lead, LeadStatus, STATUS_OPTIONS } from "@/lib/types";
import jsPDF from "jspdf";
import { ToastProvider, useToast } from "@/components/Toast";
import { LeadDetail } from "@/components/LeadDetail";
import { CrmToolbar, SortKey } from "@/components/CrmToolbar";

const TIER_INFO: Record<string, { scan: number; deliver: number; tag: string; sub: string }> = {
  Free:    { scan: 10,  deliver: 3,   tag: "Free",  sub: "Up to 3 leads per scan" },
  Pro:     { scan: 40,  deliver: 15,  tag: "Pro",   sub: "Up to 15 leads per scan" },
  Premium: { scan: 150, deliver: 150, tag: "Premium", sub: "Up to 150 leads per scan" },
};

const RECENT_KEY = "scanmap_recent_v2";
type RecentSearch = { niche: string; location: string; tier: string; ts: number };

function ScanFeed({
  logs, isScanning, leadCount, target,
}: { logs: string[]; isScanning: boolean; leadCount: number; target: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const progress = Math.min((leadCount / Math.max(target, 1)) * 100, 100);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (logs.length === 0 && !isScanning) return null;

  return (
    <div className="card mb-5 overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <span className={`status-dot ${isScanning ? "bg-[#d97706] animate-pulse" : "bg-[#2f9e44]"}`} />
          <span className="text-sm font-medium text-foreground">
            {isScanning ? "Scanning" : "Done"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {leadCount}/{target}
        </span>
      </div>
      {isScanning && (
        <div className="w-full h-1 bg-muted relative">
          <div
            className="absolute top-0 left-0 h-full bg-foreground transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <div className="h-36 overflow-y-auto px-5 py-3 font-mono text-xs space-y-1">
        {logs.map((log, i) => (
          <div
            key={i}
            className={
              log.includes("FOUND") ? "text-[#2f9e44]" :
              log.includes("ERROR") ? "text-[#d92d20]" :
              "text-muted-foreground"
            }
          >
            {log}
          </div>
        ))}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

function ScoreDistribution({ leads }: { leads: Lead[] }) {
  const buckets = useMemo(() => {
    const b = [0, 0, 0, 0, 0];
    for (const l of leads) {
      const s = l.stats?.score ?? 0;
      const i = Math.min(Math.floor(s / 20), 4);
      b[i]++;
    }
    return b;
  }, [leads]);
  const max = Math.max(1, ...buckets);
  const labels = ["0–19", "20–39", "40–59", "60–79", "80+"];
  const colors = ["#ff3b30", "#ff6b35", "#ff9500", "#34c759", "#1c7c3a"];

  return (
    <div className="card-flat p-5 col-span-2">
      <div className="label-overline mb-3">Score distribution</div>
      <div className="flex items-end gap-3 h-20">
        {buckets.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-2">
            <div
              className="w-full rounded-md transition-all"
              style={{
                height: `${(count / max) * 100}%`,
                minHeight: count > 0 ? "6px" : "2px",
                background: count === 0 ? "rgba(0,0,0,0.06)" : colors[i],
              }}
              title={`${count} lead(s)`}
            />
            <div className="text-[10px] text-muted-foreground tabular-nums">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandCenterInner() {
  const [view, setView] = useState<"hunter" | "crm">("hunter");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [vaultLeads, setVaultLeads] = useState<Lead[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [tier, setTier] = useState<keyof typeof TIER_INFO>("Free");
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | LeadStatus>("ALL");
  const [techFilter, setTechFilter] = useState("ALL");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [bulkReaudit, setBulkReaudit] = useState<{ active: boolean; done: number; total: number; msg: string }>({
    active: false, done: 0, total: 0, msg: "",
  });
  const toast = useToast();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch {}
  }, []);

  const fetchVault = useCallback(() => {
    setVaultLoading(true);
    fetch("/api/leads")
      .then((res) => res.json())
      .then((data) => setVaultLeads(data))
      .catch(() => toast.push("Failed to load", "error"))
      .finally(() => setVaultLoading(false));
  }, [toast]);

  useEffect(() => {
    if (view === "crm") fetchVault();
  }, [view, fetchVault]);

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

  const stats = useMemo(() => {
    const total = vaultLeads.length;
    const closed = vaultLeads.filter((l) => l.status === "CLOSED").length;
    const contacted = vaultLeads.filter((l) => l.status === "CONTACTED").length;
    const rate = total > 0 ? Math.round((closed / total) * 100) : 0;
    const avgScore = total > 0 ? Math.round(vaultLeads.reduce((s, l) => s + (l.stats?.score ?? 0), 0) / total) : 0;
    const techMap: Record<string, number> = {};
    for (const l of vaultLeads) {
      const k = l.tech || "Unknown";
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
    let out = vaultLeads.filter((l) => {
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

  const allFilteredSelected = filteredLeads.length > 0 && filteredLeads.every((l) => selectedIds.has(String(l.id)));

  const toggleSelectAll = () => {
    if (allFilteredSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredLeads.map((l) => String(l.id))));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitStatusChange = async (id: string, nextStatus: string) => {
    try {
      const response = await fetch(`/api/leads/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentStatus: nextStatus }),
      });
      if (response.ok) {
        setVaultLeads((prev) => prev.map((l) => (String(l.id) === String(id) ? { ...l, status: nextStatus } : l)));
        if (openLead && String(openLead.id) === String(id)) setOpenLead({ ...openLead, status: nextStatus });
      } else {
        toast.push("Update failed", "error");
      }
    } catch {
      toast.push("Update failed", "error");
    }
  };

  const onNotesSaved = (id: string, notes: string) => {
    setVaultLeads((prev) => prev.map((l) => (String(l.id) === id ? { ...l, notes } : l)));
  };

  const handleQuickStrike = (lead: Lead) => {
    if (!lead.email || lead.email === "No email found" || lead.email === "No Email Found") {
      toast.push("No email on file", "warn");
      return;
    }
    const subject = encodeURIComponent(`${lead.name}`);
    window.location.href = `mailto:${lead.email}?subject=${subject}`;
  };

  const executePurge = async () => {
    if (!purgeId) return;
    try {
      const response = await fetch(`/api/leads/${purgeId}`, { method: "DELETE" });
      if (response.ok) {
        setVaultLeads((prev) => prev.filter((l) => String(l.id) !== String(purgeId)));
        if (openLead && String(openLead.id) === purgeId) setOpenLead(null);
        setPurgeId(null);
      } else {
        toast.push("Delete failed", "error");
      }
    } catch {
      toast.push("Delete failed", "error");
    }
  };

  const bulkAction = async (action: "status" | "delete", status?: string) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids, status }),
      });
      if (!res.ok) throw new Error("bulk failed");
      const json = await res.json();
      if (action === "delete") {
        setVaultLeads((prev) => prev.filter((l) => !selectedIds.has(String(l.id))));
      } else if (action === "status" && status) {
        setVaultLeads((prev) => prev.map((l) => (selectedIds.has(String(l.id)) ? { ...l, status } : l)));
      }
      setSelectedIds(new Set());
    } catch {
      toast.push("Bulk action failed", "error");
    }
  };

  const staleCount = useMemo(
    () => vaultLeads.filter((l) => !l.audit || !l.websiteStatus || l.websiteStatus !== "audited").length,
    [vaultLeads],
  );

  const runBulkReaudit = async (idsOrAll: string[] | "stale") => {
    if (bulkReaudit.active) return;
    const ids = idsOrAll === "stale" ? undefined : idsOrAll;
    setBulkReaudit({ active: true, done: 0, total: 0, msg: "" });
    try {
      const res = await fetch("/api/leads/reaudit-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: ids ?? [] }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Bulk re-audit failed");
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");
      let succeeded = 0;
      let errored = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n\n")) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.replace("data: ", "");
          if (dataStr === "[DONE]") continue;
          try {
            const ev = JSON.parse(dataStr);
            if (ev.type === "lead" && ev.lead) {
              succeeded++;
              setVaultLeads((prev) => prev.map((l) => (String(l.id) === String(ev.lead.id) ? ev.lead : l)));
              setBulkReaudit({
                active: true,
                done: (ev.index ?? 0) + 1,
                total: ev.total ?? 0,
                msg: ev.lead.name,
              });
            } else if (ev.type === "progress") {
              setBulkReaudit((s) => ({ ...s, total: ev.total ?? s.total, msg: ev.msg ?? s.msg }));
            } else if (ev.type === "error") {
              errored++;
              setBulkReaudit((s) => ({
                ...s,
                done: (ev.index ?? s.done) + 1,
                total: ev.total ?? s.total,
                msg: ev.msg ?? "Error",
              }));
            }
          } catch { /* parse error */ }
        }
      }
      toast.push(`${succeeded} updated${errored ? `, ${errored} failed` : ""}`, errored > 0 ? "warn" : "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed", "error");
    } finally {
      setBulkReaudit({ active: false, done: 0, total: 0, msg: "" });
    }
  };

  const copyAllEmails = () => {
    const ids = selectedIds.size > 0 ? selectedIds : new Set(filteredLeads.map((l) => String(l.id)));
    const list = vaultLeads
      .filter((l) => ids.has(String(l.id)))
      .map((l) => l.email)
      .filter((e) => e && e !== "No email found" && e !== "No Email Found");
    if (list.length === 0) {
      toast.push("No valid emails", "warn");
      return;
    }
    navigator.clipboard.writeText(list.join(", "));
    toast.push(`Copied ${list.length}`, "success");
  };

  const downloadPDF = (item: Lead) => {
    const doc = new jsPDF();
    const W = 210, M = 18;
    let y = M;

    // Header band
    doc.setFillColor(255, 107, 53);
    doc.rect(0, 0, W, 6, "F");

    // Brand
    doc.setTextColor(110, 110, 115);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Scanmap audit", M, y + 6);
    y += 14;

    // Title
    doc.setTextColor(29, 29, 31);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    const titleLines = doc.splitTextToSize(item.name, W - 2 * M);
    doc.text(titleLines, M, y);
    y += titleLines.length * 7 + 2;

    doc.setTextColor(110, 110, 115);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(item.address || "—", M, y);
    y += 10;

    // Score
    const scoreColor: [number, number, number] =
      item.stats.score >= 70 ? [28, 124, 58] :
      item.stats.score >= 40 ? [177, 90, 0] : [177, 37, 29];
    doc.setFillColor(245, 245, 247);
    doc.roundedRect(M, y, 55, 30, 3, 3, "F");
    doc.setTextColor(...scoreColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.text(`${item.stats.score}`, M + 6, y + 22);
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 115);
    doc.setFont("helvetica", "normal");
    doc.text("/ 100 score", M + 28, y + 14);
    doc.text(item.stats.riskLevel + " risk", M + 28, y + 22);
    y += 36;

    // Quick contact block
    doc.setTextColor(29, 29, 31);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Contact", M, y);
    y += 5;
    doc.setDrawColor(230, 230, 230);
    doc.line(M, y, W - M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const fields: [string, string][] = [
      ["Website", item.url || "—"],
      ["Email", item.email || "—"],
      ["Phone", item.phone || "—"],
      ["Stack", item.tech || "—"],
      ["Status", item.status ?? "NEW"],
    ];
    for (const [k, v] of fields) {
      doc.setTextColor(110, 110, 115);
      doc.text(k, M, y);
      doc.setTextColor(29, 29, 31);
      const lines = doc.splitTextToSize(v, W - 2 * M - 28);
      doc.text(lines, M + 28, y);
      y += Math.max(6, lines.length * 5);
    }
    y += 4;

    // SEO breakdown
    if (item.scoreFactors && item.scoreFactors.length > 0) {
      doc.setTextColor(29, 29, 31);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("SEO breakdown", M, y);
      y += 5;
      doc.line(M, y, W - M, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      for (const f of item.scoreFactors) {
        if (y > 270) { doc.addPage(); y = M; }
        doc.setTextColor(f.ok ? 28 : 177, f.ok ? 124 : 37, f.ok ? 58 : 29);
        doc.text(f.ok ? "✓" : "×", M, y);
        doc.setTextColor(29, 29, 31);
        doc.text(f.label, M + 6, y);
        doc.setTextColor(110, 110, 115);
        const tail = `${f.value ? f.value + "  " : ""}${f.awarded}/${f.weight}`;
        doc.text(tail, W - M, y, { align: "right" });
        y += 5;
      }
      y += 4;
    }

    // Pitch
    if (y > 250) { doc.addPage(); y = M; }
    doc.setTextColor(29, 29, 31);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Suggested pitch", M, y);
    y += 5;
    doc.line(M, y, W - M, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 67);
    const pitchLines = doc.splitTextToSize(item.pitch || "", W - 2 * M);
    doc.text(pitchLines, M, y);
    y += pitchLines.length * 5 + 4;

    // Notes
    if (item.notes && item.notes.trim()) {
      if (y > 250) { doc.addPage(); y = M; }
      doc.setTextColor(29, 29, 31);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Notes", M, y);
      y += 5;
      doc.line(M, y, W - M, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 67);
      const noteLines = doc.splitTextToSize(item.notes, W - 2 * M);
      doc.text(noteLines, M, y);
    }

    // Footer
    doc.setTextColor(160, 160, 167);
    doc.setFontSize(8);
    doc.text(`scanmap · ${new Date().toISOString().slice(0, 10)}`, M, 290);

    doc.save(`scanmap_${item.name.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`);
  };

  const pushRecent = (entry: RecentSearch) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => !(r.niche === entry.niche && r.location === entry.location));
      const next = [entry, ...filtered].slice(0, 5);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const runHunter = async () => {
    if (!niche.trim() || !location.trim()) {
      toast.push("Industry and location required", "warn");
      return;
    }
    setLeads([]);
    setScanLogs([
      `Searching "${niche}" in ${location}`,
      `Plan: ${tier} (up to ${TIER_INFO[tier].deliver} leads)`,
    ]);
    setIsScanning(true);
    pushRecent({ niche, location, tier, ts: Date.now() });

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, location, tier: tier.toUpperCase() }),
      });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");
        lines.forEach((line) => {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "");
            if (dataStr === "[DONE]") {
              setScanLogs((prev) => [...prev, `Done`]);
              return;
            }
            try {
              const event = JSON.parse(dataStr);
              if (event.status === "result") {
                setLeads((prev) => [event.data, ...prev]);
                setScanLogs((prev) => [...prev, `FOUND  ${event.data.name}  (score ${event.data.stats.score})`]);
              } else if (event.status === "auditing") {
                setScanLogs((prev) => [...prev, event.msg]);
              } else if (event.status === "error") {
                setScanLogs((prev) => [...prev, `ERROR  ${event.msg}`]);
              }
            } catch {}
          }
        });
      }
    } catch {
      setScanLogs((prev) => [...prev, "ERROR  Connection failure"]);
      toast.push("Scan failed", "error");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="min-h-screen w-full">
      {/* Top nav */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.location.reload()}>
            <div className="w-8 h-8 rounded-(--radius-sm) bg-foreground text-white flex items-center justify-center font-semibold text-sm">
              s
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground">Scanmap</span>
          </div>
          <nav className="flex items-center gap-1 bg-muted rounded-full p-1">
            <button
              onClick={() => setView("hunter")}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${view === "hunter" ? "bg-card shadow-(--shadow-sm) text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Find
            </button>
            <button
              onClick={() => setView("crm")}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all flex items-center gap-2 ${view === "crm" ? "bg-card shadow-(--shadow-sm) text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Library
              {stats.total > 0 && (
                <span className="text-[10px] tabular-nums bg-foreground text-white rounded-full px-1.5 py-0.5">
                  {stats.total}
                </span>
              )}
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 lg:px-10 py-10 lg:py-14">
        {view === "hunter" ? (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Hero */}
            <section className="text-center max-w-2xl mx-auto mb-8">
              <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight text-foreground mb-2">
                Find leads.
              </h1>
              <p className="text-base text-muted-foreground">
                Search local businesses, audit their websites.
              </p>
            </section>

            {/* Search form */}
            <section className="card max-w-2xl mx-auto p-6 mb-10">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <input
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !isScanning && runHunter()}
                  placeholder="Industry"
                  className="input"
                  disabled={isScanning}
                />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !isScanning && runHunter()}
                  placeholder="Location"
                  className="input"
                  disabled={isScanning}
                />
              </div>

              {/* Tier picker */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                {(Object.keys(TIER_INFO) as Array<keyof typeof TIER_INFO>).map((p) => (
                  <button
                    key={p}
                    onClick={() => setTier(p)}
                    className={`p-3 rounded-(--radius) text-left transition-all border ${
                      tier === p
                        ? "border-foreground bg-foreground text-white"
                        : "border-border bg-muted text-foreground hover:border-(--border-strong)"
                    }`}
                  >
                    <div className="text-sm font-semibold">{p}</div>
                    <div className={`text-xs ${tier === p ? "opacity-70" : "text-muted-foreground"}`}>
                      {TIER_INFO[p].deliver} leads
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={runHunter}
                disabled={isScanning}
                className="btn btn-primary w-full"
              >
                {isScanning ? "Scanning" : "Search"}
              </button>
            </section>

            {/* Recent searches (compact) */}
            {recent.length > 0 && (
              <section className="max-w-2xl mx-auto mb-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="label-overline">Recent</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recent.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => { setNiche(r.niche); setLocation(r.location); setTier(r.tier as keyof typeof TIER_INFO); }}
                      disabled={isScanning}
                      className="chip chip-interactive"
                    >
                      {r.niche} <span className="text-(--tertiary-foreground)">·</span> {r.location}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Live feed + results */}
            <section className="max-w-4xl mx-auto">
              <ScanFeed logs={scanLogs} isScanning={isScanning} leadCount={leads.length} target={TIER_INFO[tier].deliver} />
              <div className="space-y-4">
                {leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    item={lead}
                    onOpen={(l) => setOpenLead(l)}
                    onDownloadPDF={downloadPDF}
                  />
                ))}
                {leads.length === 0 && !isScanning && (
                  <div className="card-flat p-10 text-center">
                    <p className="text-sm text-muted-foreground mb-4">Try a sample search:</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {[
                        { n: "dentist", l: "Austin" },
                        { n: "yoga studio", l: "Bali" },
                        { n: "law firm", l: "Chicago" },
                      ].map((p) => (
                        <button
                          key={p.n}
                          onClick={() => { setNiche(p.n); setLocation(p.l); }}
                          className="chip chip-interactive"
                        >
                          {p.n} in {p.l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="animate-in fade-in duration-300">
            {/* Stats */}
            <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
              <StatCard label="Total" value={stats.total} />
              <StatCard label="Engaged" value={stats.contacted} tone="warn" />
              <StatCard label="Won" value={stats.closed} tone="success" />
              <StatCard label="Win rate" value={`${stats.rate}%`} />
              <StatCard
                label="Avg score"
                value={stats.avgScore}
                sub={stats.topTech ? `Top stack: ${stats.topTech[0]} (${stats.topTech[1]})` : undefined}
              />
              <ScoreDistribution leads={vaultLeads} />
            </section>

            {/* Stale-data alert */}
            {staleCount > 0 && !bulkReaudit.active && (
              <section className="card-flat p-3 mb-4 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="text-foreground font-medium">{staleCount} not audited</span>
                  <span className="text-muted-foreground"> · use re-audit to fetch fresh data</span>
                </div>
                <button onClick={() => runBulkReaudit("stale")} className="btn btn-primary btn-sm shrink-0">
                  Re-audit all
                </button>
              </section>
            )}

            {/* Bulk re-audit progress */}
            {bulkReaudit.active && (
              <section className="card-flat p-3 mb-4">
                <div className="flex items-center justify-between gap-3 mb-2 text-sm">
                  <span className="text-foreground font-medium">Re-auditing</span>
                  <span className="text-muted-foreground tabular-nums">{bulkReaudit.done}/{bulkReaudit.total}</span>
                </div>
                <div className="w-full h-0.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-foreground transition-all duration-300"
                    style={{ width: bulkReaudit.total ? `${(bulkReaudit.done / bulkReaudit.total) * 100}%` : "0%" }}
                  />
                </div>
              </section>
            )}

            <section className="card overflow-hidden">
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
                <div className="px-6 py-3 bg-muted border-b border-border flex flex-wrap items-center gap-2 animate-in slide-in-from-top-2 duration-200">
                  <span className="text-sm font-medium text-foreground mr-2">
                    {selectedIds.size} selected
                  </span>
                  <span className="h-4 w-px bg-border" />
                  {STATUS_OPTIONS.map((s) => (
                    <button key={s} onClick={() => bulkAction("status", s)} className="btn btn-secondary btn-sm">
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </button>
                  ))}
                  <button onClick={copyAllEmails} className="btn btn-secondary btn-sm">Copy emails</button>
                  <button
                    onClick={() => runBulkReaudit([...selectedIds])}
                    disabled={bulkReaudit.active}
                    className="btn btn-secondary btn-sm"
                  >
                    Re-audit
                  </button>
                  <button
                    onClick={() => { if (confirm(`Delete ${selectedIds.size} lead(s)?`)) bulkAction("delete"); }}
                    className="btn btn-danger btn-sm ml-auto"
                  >
                    Delete
                  </button>
                  <button onClick={() => setSelectedIds(new Set())} className="btn btn-ghost btn-sm">Clear</button>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[800px]">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-6 py-3 w-10">
                        <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="accent-foreground cursor-pointer" />
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lead</th>
                      <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stack</th>
                      <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Score</th>
                      <th className="px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vaultLoading && Array.from({ length: 4 }).map((_, i) => (
                      <tr key={`skel-${i}`} className="border-b border-border">
                        <td className="px-6 py-4"><div className="w-4 h-4 bg-muted animate-pulse rounded-sm" /></td>
                        <td className="px-4 py-4">
                          <div className="h-4 w-48 bg-muted animate-pulse rounded mb-2" />
                          <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                        </td>
                        <td className="px-4 py-4"><div className="h-5 w-16 bg-muted animate-pulse rounded-full" /></td>
                        <td className="px-4 py-4"><div className="h-4 w-10 bg-muted animate-pulse rounded" /></td>
                        <td className="px-4 py-4"><div className="h-6 w-20 bg-muted animate-pulse rounded-full" /></td>
                        <td className="px-4 py-4"><div className="h-7 w-24 bg-muted animate-pulse rounded-full ml-auto" /></td>
                      </tr>
                    ))}
                    {!vaultLoading && filteredLeads.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-12 text-center">
                          <p className="text-sm text-muted-foreground">
                            {vaultLeads.length === 0 ? "Nothing here yet. Run a scan from Find." : "No leads match these filters."}
                          </p>
                        </td>
                      </tr>
                    )}
                    {!vaultLoading && filteredLeads.map((lead) => {
                      const id = String(lead.id);
                      const sel = selectedIds.has(id);
                      const status = lead.status || "NEW";
                      const score = lead.stats?.score ?? 0;
                      const scoreColor =
                        score >= 70 ? "text-[#1c7c3a]" :
                        score >= 40 ? "text-[#b15a00]" : "text-[#b1251d]";
                      return (
                        <tr
                          key={lead.id}
                          className={`border-b border-border transition-colors cursor-pointer ${sel ? "bg-(--primary-soft)" : "hover:bg-muted"}`}
                          onClick={() => setOpenLead(lead)}
                        >
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={sel} onChange={() => toggleOne(id)} className="accent-foreground cursor-pointer" />
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-foreground truncate max-w-[280px]">{lead.name}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[280px]">{lead.email}</div>
                            {lead.notes && (
                              <div className="text-xs text-(--tertiary-foreground) mt-1 italic truncate max-w-[280px]">{lead.notes}</div>
                            )}
                          </td>
                          <td className="px-4 py-4">{lead.tech ? <span className="chip">{lead.tech}</span> : <span className="text-muted-foreground text-xs">none</span>}</td>
                          <td className={`px-4 py-4 text-base font-semibold tabular-nums ${scoreColor}`}>{score}</td>
                          <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                            <select
                              value={status}
                              onChange={(e) => commitStatusChange(id, e.target.value)}
                              className="select"
                            >
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
          </div>
        )}
      </main>

      <LeadDetail
        lead={openLead}
        onClose={() => setOpenLead(null)}
        onStatusChange={commitStatusChange}
        onNotesSaved={onNotesSaved}
        onPurge={(id) => setPurgeId(id)}
        onDownloadPDF={downloadPDF}
        onQuickStrike={handleQuickStrike}
        onLeadRefreshed={(refreshed) => {
          setVaultLeads((prev) => prev.map((l) => (String(l.id) === String(refreshed.id) ? refreshed : l)));
          setOpenLead(refreshed);
        }}
      />

      {/* Confirm dialog */}
      {purgeId && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setPurgeId(null)}
        >
          <div
            className="card max-w-sm w-full p-6 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground mb-1">Delete?</h3>
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

function StatCard({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "success" | "warn" }) {
  const valueColor =
    tone === "success" ? "text-[#1c7c3a]" :
    tone === "warn" ? "text-[#b15a00]" : "text-foreground";
  return (
    <div className="card-flat p-4">
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
