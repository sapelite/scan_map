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

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function CrmToolbar(props: CrmToolbarProps) {
  const {
    searchTerm, setSearchTerm,
    statusFilter, setStatusFilter,
    techFilter, setTechFilter,
    sort, setSort,
    techOptions, counts, total,
  } = props;

  const Pill = ({ value, label, count }: { value: "ALL" | LeadStatus; label: string; count: number }) => {
    const active = statusFilter === value;
    return (
      <button
        onClick={() => setStatusFilter(value)}
        className={`chip chip-interactive ${active ? "chip-active" : ""}`}
      >
        <span>{label}</span>
        <span className={`text-[10px] tabular-nums ${active ? "opacity-70" : "text-(--tertiary-foreground)"}`}>
          {count}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-6 border-b border-border">
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
        <div className="relative flex-1 max-w-lg">
          <input
            type="text"
            placeholder="Search"
            className="input input-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="select"
          >
            <option value="date_desc">Newest</option>
            <option value="score_desc">Score high</option>
            <option value="score_asc">Score low</option>
            <option value="name_asc">Name</option>
          </select>
          <a href="/api/export" className="btn btn-secondary btn-sm">Export</a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Pill value="ALL" label="All" count={total} />
        {STATUS_OPTIONS.map((s) => (
          <Pill key={s} value={s} label={titleCase(s)} count={counts[s] ?? 0} />
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <select
          value={techFilter}
          onChange={(e) => setTechFilter(e.target.value)}
          className="select"
        >
          <option value="ALL">All stacks</option>
          {techOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>
  );
}
