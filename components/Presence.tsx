"use client";

import React from "react";
import { PresenceDimensions, PresenceKey } from "@/lib/types";

// ---- score → colour ---------------------------------------------------------
export const scoreHex = (s: number) => (s >= 70 ? "#0E9F6E" : s >= 40 ? "#C2710C" : "#DC2626");
export const scoreText = (s: number) =>
  s >= 70 ? "text-[#0E9F6E]" : s >= 40 ? "text-[#C2710C]" : "text-[#DC2626]";

// Lower presence = bigger opportunity, so we frame it as "opportunity heat".
export const opportunityLabel = (s: number) =>
  s >= 70 ? "Low opportunity" : s >= 40 ? "Some gaps" : s >= 1 ? "High opportunity" : "Wide open";

export const DIM_ORDER: PresenceKey[] = ["site", "social", "marketing", "reputation", "content"];
export const DIM_SHORT: Record<PresenceKey, string> = {
  site: "SITE", social: "SOCIAL", marketing: "MKTG", reputation: "REP", content: "CONTENT",
};
export const DIM_FULL: Record<PresenceKey, string> = {
  site: "Website quality", social: "Social presence", marketing: "Marketing maturity",
  reputation: "Reputation & local SEO", content: "Content quality",
};

// ---- big score figure -------------------------------------------------------
export function ScoreBadge({ score, size = "lg" }: { score: number; size?: "sm" | "lg" | "xl" }) {
  const cls = size === "xl" ? "text-5xl" : size === "lg" ? "text-3xl" : "text-xl";
  return <span className={`font-semibold tabular-nums tracking-tight ${cls} ${scoreText(score)}`}>{score}</span>;
}

// ---- the five dimension meters ---------------------------------------------
export function PresenceMeters({
  dimensions, compact = false,
}: { dimensions?: PresenceDimensions; compact?: boolean }) {
  if (!dimensions) return null;
  return (
    <div className={compact ? "grid grid-cols-5 gap-2" : "space-y-2"}>
      {DIM_ORDER.map((k) => {
        const v = dimensions[k];
        if (compact) {
          return (
            <div key={k} title={`${DIM_FULL[k]}: ${v}/100`}>
              <div className="flex items-center justify-between mb-1">
                <span className="label-overline text-[9px]!">{DIM_SHORT[k]}</span>
                <span className="text-[10px] font-mono tabular-nums" style={{ color: scoreHex(v) }}>{v}</span>
              </div>
              <div className="meter"><span style={{ width: `${v}%`, background: scoreHex(v) }} /></div>
            </div>
          );
        }
        return (
          <div key={k} className="flex items-center gap-3">
            <span className="label-overline w-20 shrink-0">{DIM_SHORT[k]}</span>
            <div className="meter flex-1"><span style={{ width: `${v}%`, background: scoreHex(v) }} /></div>
            <span className="text-xs font-mono tabular-nums w-7 text-right" style={{ color: scoreHex(v) }}>{v}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- inline help tooltip ----------------------------------------------------
export function InfoDot({ tip }: { tip: string }) {
  return (
    <span className="relative inline-flex group align-middle">
      <span
        className="w-3.5 h-3.5 rounded-full border border-border text-[9px] leading-none flex items-center justify-center text-tertiary-foreground cursor-help font-mono"
        style={{ color: "var(--tertiary-foreground)" }}
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-52 z-50
                   opacity-0 group-hover:opacity-100 transition-opacity duration-150
                   rounded-md border border-border bg-card px-2.5 py-2 text-[11px] leading-snug text-muted-foreground shadow-md"
      >
        {tip}
      </span>
    </span>
  );
}
