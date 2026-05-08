"use client";

import React from "react";
import { Lead, Socials } from "@/lib/types";

interface LeadCardProps {
  item: Lead;
  onOpen?: (lead: Lead) => void;
  onDownloadPDF?: (lead: Lead) => void;
}

const scoreColor = (score: number) =>
  score >= 70 ? "text-[#2f9e44]" : score >= 40 ? "text-[#d97706]" : "text-[#d92d20]";

function SocialIcons({ socials }: { socials: Socials }) {
  const items: Array<{ key: string; href: string | null; label: string }> = [
    { key: "instagram", href: socials.instagram, label: "IG" },
    { key: "facebook",  href: socials.facebook,  label: "FB" },
    { key: "linkedin",  href: socials.linkedin,  label: "in" },
    { key: "twitter",   href: socials.twitter,   label: "X" },
    { key: "tiktok",    href: socials.tiktok,    label: "TT" },
    { key: "youtube",   href: socials.youtube,   label: "YT" },
  ];
  const present = items.filter(i => i.href);
  if (present.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {present.map(p => (
        <a
          key={p.key}
          href={p.href!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-6 h-6 rounded-full bg-muted hover:bg-foreground hover:text-white text-muted-foreground flex items-center justify-center transition-colors text-[10px] font-medium"
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
  const websiteHref = item.websiteFromMaps || (audit?.finalUrl && audit.finalUrl !== "No website detected" ? audit.finalUrl : null);

  let badge: string;
  if (status === "none") badge = "No website";
  else if (status === "unreachable") badge = "Unreachable";
  else if (item.isSocialUrl) badge = "Social only";
  else badge = "Audited";

  return (
    <div className="card card-interactive p-5" onClick={() => onOpen?.(item)}>
      <div className="flex items-start gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="chip">{badge}</span>
            {item.tech && item.tech !== "Unknown" && <span className="chip">{item.tech}</span>}
            {item.rating > 0 && (
              <span className="chip">{item.rating}★ <span className="text-(--tertiary-foreground)">{item.reviews || "0"}</span></span>
            )}
          </div>

          <h3 className="text-lg font-semibold tracking-tight text-foreground mb-1 truncate">
            {item.name}
          </h3>
          <p className="text-sm text-muted-foreground truncate mb-4">
            {item.address || "No address"}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="min-w-0">
              <div className="label-overline mb-0.5">Website</div>
              {status === "audited" && audit ? (
                <a
                  href={audit.finalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-foreground hover:underline truncate block"
                >
                  {audit.finalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              ) : status === "unreachable" && websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-foreground hover:underline truncate block"
                  title={item.websiteFailReason ?? "Audit blocked"}
                >
                  {websiteHref.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
              {status === "unreachable" && item.websiteFailReason && (
                <div className="text-[11px] text-(--tertiary-foreground) mt-0.5 truncate">
                  {item.websiteFailReason}
                </div>
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
            <div className="min-w-0">
              <div className="label-overline mb-0.5">Stack</div>
              <span className="text-foreground truncate block">
                {audit?.tech?.length ? audit.tech.slice(0, 3).join(", ") : item.tech}
              </span>
            </div>
          </div>

          {audit && status === "audited" && (
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {audit.loadTimeMs > 0 && <span>{(audit.loadTimeMs / 1000).toFixed(2)}s load</span>}
              <span>{audit.wordCount.toLocaleString()} words</span>
              <span>{audit.imageCount} images</span>
              {audit.mobileViewport && <span className="text-foreground">Mobile</span>}
              {audit.httpsActive && <span className="text-foreground">HTTPS</span>}
              {audit.jsonLd && <span className="text-foreground">Schema</span>}
              <span className="ml-auto"><SocialIcons socials={audit.socials} /></span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 pt-1">
          {status === "audited" && (
            <>
              <div className={`text-3xl font-semibold tabular-nums tracking-tight ${scoreColor(item.stats.score)}`}>
                {item.stats.score}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {item.stats.riskLevel} risk
              </div>
              {onDownloadPDF && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDownloadPDF(item); }}
                  className="btn btn-ghost btn-sm mt-1"
                >
                  PDF
                </button>
              )}
            </>
          )}
          {status !== "audited" && (
            <div className="text-[10px] text-muted-foreground">Not audited</div>
          )}
        </div>
      </div>
    </div>
  );
};
