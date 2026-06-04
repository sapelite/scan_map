"use client";

import React from "react";
import { Lead, LeadStatus, STATUS_OPTIONS } from "@/lib/types";
import { contactChannels, followUpDue } from "@/lib/leadValue";

export type SortKey = "value_desc" | "date_desc" | "score_desc" | "score_asc" | "name_asc";

export type QuickFilterKey =
  | "no_website"
  | "broken"
  | "high_opp"
  | "no_instagram"
  | "no_marketing"
  | "no_social"
  | "low_reviews"
  | "reachable"
  | "follow_up"
  | "has_email"
  | "has_whatsapp"
  | "outdated_stack";

export interface QuickFilter {
  key: QuickFilterKey;
  label: string;
}

export const QUICK_FILTERS: QuickFilter[] = [
  { key: "high_opp",       label: "High opportunity" },
  { key: "no_website",     label: "No website" },
  { key: "broken",         label: "Site down" },
  { key: "no_instagram",   label: "No Instagram" },
  { key: "no_marketing",   label: "Weak marketing" },
  { key: "no_social",      label: "No socials" },
  { key: "low_reviews",    label: "Few reviews" },
  { key: "outdated_stack", label: "Wix / Squarespace" },
  { key: "reachable",      label: "Reachable" },
  { key: "follow_up",      label: "Follow up due" },
  { key: "has_email",      label: "Has email" },
  { key: "has_whatsapp",   label: "Has WhatsApp" },
];

// ---- Accurate, data-driven predicates (independent of the opportunities array,
//      so they work for old leads too and stay precise) -----------------------
const hasRealWebsite = (l: Lead) => {
  if (l.websiteFromMaps) return true;
  const u = (l.url || "").toLowerCase();
  return /^https?:/.test(u) && !u.startsWith("no website");
};
const realEmail = (l: Lead) => !!l.email && !/^no email/i.test(l.email);
const reviewCountOf = (l: Lead) => l.reviewCount ?? (parseInt(String(l.reviews || "").replace(/[^\d]/g, ""), 10) || 0);
// Use the merged socials (website + Maps + search), so no-website leads whose
// Instagram we found aren't wrongly flagged "No Instagram" / "No socials".
const socialsOf = (l: Lead) => l.socials ?? l.audit?.socials;
const igOf = (l: Lead) => socialsOf(l)?.instagram;
const socialCountOf = (l: Lead) => {
  const s = socialsOf(l);
  return s ? Object.values(s).filter(Boolean).length : 0;
};

export function matchesQuickFilter(l: Lead, key: QuickFilterKey): boolean {
  switch (key) {
    case "high_opp":       return (l.stats?.score ?? 0) < 40;
    case "no_website":     return l.websiteStatus === "none" || (!l.websiteStatus && !hasRealWebsite(l));
    case "broken":         return l.websiteStatus === "unreachable";
    case "no_instagram":   return !igOf(l);
    case "no_marketing": {
      const m = l.stats?.dimensions?.marketing;
      if (typeof m === "number") return m < 30;
      const a = l.audit;
      return a ? (!a.hasGoogleAnalytics && !a.hasGoogleTagManager && (a.adPixels?.length ?? 0) === 0) : false;
    }
    case "no_social":      return socialCountOf(l) === 0;
    case "low_reviews":    return reviewCountOf(l) < 10;
    case "outdated_stack": return l.tech === "Wix" || l.tech === "Squarespace";
    case "reachable":      return contactChannels(l) > 0;
    case "follow_up":      return followUpDue(l);
    case "has_email":      return realEmail(l);
    case "has_whatsapp":   return !!(l.whatsapp || l.audit?.whatsapp);
    default:               return true;
  }
}

/** Count how many leads match each quick filter (for the chip badges). */
export function quickFilterCounts(leads: Lead[]): Record<QuickFilterKey, number> {
  const counts = Object.fromEntries(QUICK_FILTERS.map((q) => [q.key, 0])) as Record<QuickFilterKey, number>;
  for (const l of leads) for (const q of QUICK_FILTERS) if (matchesQuickFilter(l, q.key)) counts[q.key]++;
  return counts;
}

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
  quickFilters: Set<QuickFilterKey>;
  toggleQuickFilter: (k: QuickFilterKey) => void;
  clearQuickFilters: () => void;
  filteredCount: number;
  quickCounts: Record<QuickFilterKey, number>;
  onExport: () => void;
  selectedCount: number;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function CrmToolbar(props: CrmToolbarProps) {
  const {
    searchTerm, setSearchTerm,
    statusFilter, setStatusFilter,
    techFilter, setTechFilter,
    sort, setSort,
    techOptions, counts, total,
    quickFilters, toggleQuickFilter, clearQuickFilters,
    filteredCount, quickCounts, onExport, selectedCount,
  } = props;

  const StatusPill = ({ value, label, count }: { value: "ALL" | LeadStatus; label: string; count: number }) => {
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
    <div className="flex flex-col gap-3 p-5 border-b border-border">
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
        <div className="flex-1 max-w-lg">
          <input
            type="text"
            placeholder="Search"
            className="input input-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center">
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="select">
            <option value="value_desc">Hottest leads</option>
            <option value="date_desc">Newest</option>
            <option value="score_desc">Score high</option>
            <option value="score_asc">Score low</option>
            <option value="name_asc">Name</option>
          </select>
          <button
            onClick={onExport}
            className="btn btn-secondary btn-sm"
            title={selectedCount > 0 ? `Export ${selectedCount} selected as CSV` : "Export the current filtered list as CSV"}
          >
            {selectedCount > 0 ? `Export ${selectedCount}` : "Export"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <StatusPill value="ALL" label="All" count={total} />
        {STATUS_OPTIONS.map((s) => (
          <StatusPill key={s} value={s} label={titleCase(s)} count={counts[s] ?? 0} />
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)} className="select">
          <option value="ALL">All stacks</option>
          {techOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="label-overline mr-1">Quick filters</span>
        {QUICK_FILTERS.map(qf => {
          const active = quickFilters.has(qf.key);
          const n = quickCounts[qf.key] ?? 0;
          return (
            <button
              key={qf.key}
              onClick={() => toggleQuickFilter(qf.key)}
              disabled={n === 0 && !active}
              title={n === 0 ? "No leads match this filter" : `${n} lead${n === 1 ? "" : "s"} match`}
              className={`chip chip-interactive ${active ? "chip-active" : ""} ${n === 0 && !active ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {qf.label}
              <span className={`text-[10px] tabular-nums ${active ? "opacity-70" : "text-(--tertiary-foreground)"}`}>{n}</span>
            </button>
          );
        })}
        {quickFilters.size > 0 && (
          <button onClick={clearQuickFilters} className="btn btn-ghost btn-sm">Clear</button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filteredCount} of {total}
        </span>
      </div>
    </div>
  );
}
