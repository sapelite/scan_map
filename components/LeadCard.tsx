"use client";

import React from "react";
import { Lead, Socials, OPPORTUNITY_META } from "@/lib/types";
import { PresenceMeters, ScoreBadge, opportunityLabel } from "@/components/Presence";

interface LeadCardProps {
  item: Lead;
  onOpen?: (lead: Lead) => void;
  onDownloadPDF?: (lead: Lead, mode?: "client" | "admin") => void;
}

function SocialIcons({ socials }: { socials: Socials }) {
  const items: Array<{ key: string; href: string | null; label: string }> = [
    { key: "instagram", href: socials.instagram, label: "IG" },
    { key: "facebook", href: socials.facebook, label: "FB" },
    { key: "linkedin", href: socials.linkedin, label: "in" },
    { key: "twitter", href: socials.twitter, label: "X" },
    { key: "tiktok", href: socials.tiktok, label: "TT" },
    { key: "youtube", href: socials.youtube, label: "YT" },
  ];
  const present = items.filter((i) => i.href);
  if (present.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {present.map((p) => (
        <a
          key={p.key}
          href={p.href!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-6 h-6 rounded-sm bg-muted hover:bg-foreground hover:text-white text-muted-foreground flex items-center justify-center transition-colors text-[10px] font-medium font-mono"
          title={p.key}
        >
          {p.label}
        </a>
      ))}
    </div>
  );
}

export const LeadCard = ({ item, onOpen, onDownloadPDF }: LeadCardProps) => {
  const audit = item.audit;
  const status = item.websiteStatus ?? (audit?.reachable ? "audited" : "none");
  const websiteHref =
    item.websiteFromMaps ||
    (audit?.finalUrl && audit.finalUrl !== "No website detected" ? audit.finalUrl : null);

  const badge =
    status === "none" ? "No website" :
    status === "unreachable" ? "Site down" :
    item.isSocialUrl ? "Social only" : "Audited";

  const score = item.stats?.score ?? 0;
  const opps = item.opportunities ?? [];

  return (
    <div className="panel card-interactive" onClick={() => onOpen?.(item)}>
      {/* header strip */}
      <div className="panel-head">
        <div className="flex items-center gap-2 min-w-0">
          <span className="panel-title truncate">{item.category || badge}</span>
          {item.rating > 0 && (
            <span className="panel-meta">★ {item.rating.toFixed(1)} · {item.reviewCount || 0}</span>
          )}
        </div>
        <span className={`chip ${status === "none" || status === "unreachable" ? "" : ""}`}>{badge}</span>
      </div>

      <div className="p-5">
        <div className="flex items-start gap-5">
          {/* main */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-foreground truncate">{item.name}</h3>
            <p className="text-sm text-muted-foreground truncate mb-4">{item.address || "No address"}</p>

            {/* the five-dimension presence meters, the signature visual */}
            <div className="mb-4">
              <PresenceMeters dimensions={item.stats?.dimensions} compact />
            </div>

            {/* contact quick row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-5 gap-y-2 text-sm">
              <div className="min-w-0">
                <div className="label-overline mb-0.5">Website</div>
                {websiteHref ? (
                  <a
                    href={websiteHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-foreground hover:text-(--teal-deep) hover:underline truncate block"
                    title={status === "unreachable" ? item.websiteFailReason ?? "Unreachable" : undefined}
                  >
                    {websiteHref.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="label-overline mb-0.5">Email</div>
                <span className="text-foreground select-all truncate block">
                  {item.email && item.email !== "No email found" ? item.email : <span className="text-muted-foreground">None</span>}
                </span>
              </div>
              <div className="min-w-0">
                <div className="label-overline mb-0.5">Phone</div>
                <span className="text-foreground select-all truncate block">
                  {item.phone && item.phone !== "No Phone" ? item.phone : <span className="text-muted-foreground">None</span>}
                </span>
              </div>
            </div>

            {/* sales-angle chips */}
            {opps.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {opps.slice(0, 5).map((o) => (
                  <span
                    key={o}
                    className="chip"
                    style={{ background: "var(--teal-soft)", borderColor: "rgba(13,148,136,0.30)", color: "var(--teal-deep)" }}
                    title={OPPORTUNITY_META[o].long}
                  >
                    {OPPORTUNITY_META[o].short}
                  </span>
                ))}
                {opps.length > 5 && <span className="chip text-muted-foreground">+{opps.length - 5}</span>}
              </div>
            )}

            {/* pitch + socials */}
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground italic truncate">{item.pitch}</p>
              {audit && <SocialIcons socials={audit.socials} />}
            </div>
          </div>

          {/* score column */}
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <ScoreBadge score={score} />
            <div className="label-overline text-[9px]!">presence</div>
            <div className="text-[10px] mt-1" style={{ color: score >= 70 ? "var(--good)" : score >= 40 ? "var(--warn)" : "var(--bad)" }}>
              {opportunityLabel(score)}
            </div>
            {onDownloadPDF && (
              <button
                onClick={(e) => { e.stopPropagation(); onDownloadPDF(item, "client"); }}
                className="btn btn-ghost btn-sm mt-2"
                title="Download a client-ready audit report"
              >
                Report
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
