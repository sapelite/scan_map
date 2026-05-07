"use client";

import React from "react";
import { LeadStatus, STATUS_OPTIONS } from "@/lib/types";

export type SortKey = "date_desc" | "score_desc" | "score_asc" | "name_asc";

interface CrmToolbarProps {
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  statusFilter: "ALL" | LeadStatus;
  setStatusFilter: (s: "ALL" | LeadStatus) => void;
  techFilter: string;
  setTechFilter: (s: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  techOptions: string[];
  counts: Record<string, number>;
  total: number;
}

const STATUS_TINTS: Record<LeadStatus | "ALL", string> = {
  ALL:       "border-zinc-700 text-zinc-400 hover:border-white",
  NEW:       "border-primary/40 text-primary hover:border-primary",
  CONTACTED: "border-amber-500/40 text-amber-400 hover:border-amber-400",
  CLOSED:    "border-emerald-500/40 text-emerald-400 hover:border-emerald-400",
  REJECTED:  "border-rose-500/40 text-rose-400 hover:border-rose-400",
};

const STATUS_ACTIVE: Record<LeadStatus | "ALL", string> = {
  ALL:       "bg-white text-black border-white",
  NEW:       "bg-primary text-black border-primary",
  CONTACTED: "bg-amber-500 text-black border-amber-500",
  CLOSED:    "bg-emerald-500 text-black border-emerald-500",
  REJECTED:  "bg-rose-500 text-black border-rose-500",
};

export function CrmToolbar(props: CrmToolbarProps) {
  const {
    searchTerm, setSearchTerm,
    statusFilter, setStatusFilter,
    techFilter, setTechFilter,
    sort, setSort,
    techOptions, counts, total,
  } = props;

  const StatusPill = ({ value, label, count }: { value: "ALL" | LeadStatus; label: string; count: number }) => {
    const active = statusFilter === value;
    return (
      <button
        onClick={() => setStatusFilter(value)}
        className={`px-3 py-2 text-[10px] font-black uppercase border transition-all cursor-pointer flex items-center gap-2 ${
          active ? STATUS_ACTIVE[value] : STATUS_TINTS[value]
        }`}
      >
        <span>{label}</span>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 ${active ? "bg-black/20" : "bg-zinc-800"}`}>
          {count}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-6 border-b border-border bg-zinc-900/20">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-6 flex-1 w-full">
          <h2 className="text-xl font-black uppercase tracking-tighter italic whitespace-nowrap">
            Secured Database
          </h2>
          <div className="relative flex-1 max-w-sm">
            <input
              type="text"
              placeholder="SEARCH NAME / EMAIL / TECH..."
              className="bg-black border border-border text-[10px] font-mono p-3 w-full focus:border-primary outline-none transition-all pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="bg-black border border-border text-[10px] font-mono uppercase p-3 focus:border-primary outline-none cursor-pointer"
          >
            <option value="date_desc">Sort: Newest</option>
            <option value="score_desc">Sort: Score ↓</option>
            <option value="score_asc">Sort: Score ↑</option>
            <option value="name_asc">Sort: Name A-Z</option>
          </select>
          <a href="/api/export" className="btn-primary py-3 px-4 text-[10px] cursor-pointer whitespace-nowrap">
            Export CSV
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <StatusPill value="ALL" label="All" count={total} />
        {STATUS_OPTIONS.map((s) => (
          <StatusPill key={s} value={s} label={s} count={counts[s] ?? 0} />
        ))}
        <span className="mx-2 h-6 w-px bg-zinc-800" />
        <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Tech:</span>
        <select
          value={techFilter}
          onChange={(e) => setTechFilter(e.target.value)}
          className="bg-black border border-border text-[10px] font-mono uppercase p-2 focus:border-primary outline-none cursor-pointer"
        >
          <option value="ALL">All Stacks</option>
          {techOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
