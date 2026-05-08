"use client";

import React from "react";
import { Lead, Socials } from "@/lib/types";

interface LeadCardProps {
  item: Lead;
  onOpen?: (lead: Lead) => void;
  onDownloadPDF?: (lead: Lead) => void;
}

const scoreClass = (score: number) =>
  score >= 70 ? "score-good" : score >= 40 ? "score-mid" : "score-bad";

const ringStrokeColor = (score: number) =>
  score >= 70 ? "#34c759" : score >= 40 ? "#ff9500" : "#ff3b30";

function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={ringStrokeColor(score)} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <span className="absolute text-base font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function SocialIcons({ socials }: { socials: Socials }) {
  const items: Array<{ key: string; href: string | null; svg: React.ReactNode }> = [
    { key: "instagram", href: socials.instagram, svg: <span className="text-[10px]">IG</span> },
    { key: "facebook",  href: socials.facebook,  svg: <span className="text-[10px]">FB</span> },
    { key: "linkedin",  href: socials.linkedin,  svg: <span className="text-[10px]">in</span> },
    { key: "twitter",   href: socials.twitter,   svg: <span className="text-[10px]">X</span> },
    { key: "tiktok",    href: socials.tiktok,    svg: <span className="text-[10px]">TT</span> },
    { key: "youtube",   href: socials.youtube,   svg: <span className="text-[10px]">YT</span> },
  ];
  const present = items.filter(i => i.href);
  if (present.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      {present.map(p => (
        <a
          key={p.key}
          href={p.href!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-7 h-7 rounded-full bg-muted hover:bg-foreground hover:text-white text-muted-foreground flex items-center justify-center transition-colors font-semibold"
          title={p.key}
        >
          {p.svg}
        </a>
      ))}
    </div>
  );
}

export const LeadCard = ({ item, onOpen, onDownloadPDF }: LeadCardProps) => {
  const audit = item.audit;
  const status = item.websiteStatus ?? (audit?.reachable ? "audited" : "none");
  const social = item.isSocialUrl;
  const websiteHref = item.websiteFromMaps || (audit?.finalUrl && audit.finalUrl !== "No website detected" ? audit.finalUrl : null);

  let badge: string;
  let badgeClass: string;
  if (status === "none") {
    badge = "No website";
    badgeClass = "bg-[rgba(255,59,48,0.10)] text-[#b1251d]";
  } else if (status === "unreachable") {
    badge = "Site unreachable";
    badgeClass = "bg-[rgba(255,149,0,0.14)] text-[#b15a00]";
  } else if (social) {
    badge = "Social only";
    badgeClass = "bg-[rgba(255,149,0,0.14)] text-[#b15a00]";
  } else {
    badge = "Audited";
    badgeClass = "bg-[rgba(52,199,89,0.12)] text-[#1c7c3a]";
  }

  return (
    <div
      className="card card-interactive p-6"
      onClick={() => onOpen?.(item)}
    >
      <div className="flex items-start gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`chip ${badgeClass}`}>{badge}</span>
            {item.tech && item.tech !== "Unknown" && (
              <span className="chip">{item.tech}</span>
            )}
            {item.rating > 0 && (
              <span className="chip">★ {item.rating} <span className="text-(--tertiary-foreground)">· {item.reviews || "0"}</span></span>
            )}
          </div>

          <h3 className="text-xl font-semibold tracking-tight text-foreground mb-1 truncate">
            {item.name}
          </h3>
          <p className="text-sm text-muted-foreground truncate mb-4">
            {item.address || "Location unavailable"}
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
                  className="text-foreground hover:text-primary transition-colors truncate block"
                >
                  {audit.finalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              ) : status === "unreachable" && websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[#b15a00] hover:underline truncate block"
                  title={item.websiteFailReason ?? "Audit blocked"}
                >
                  {websiteHref.replace(/^https?:\/\//, "").replace(/\/$/, "")} <span className="text-(--tertiary-foreground)">↗</span>
                </a>
              ) : (
                <span className="text-muted-foreground">Not detected</span>
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
                {item.email || "—"}
              </span>
            </div>
            <div className="min-w-0">
              <div className="label-overline mb-0.5">Phone</div>
              <span className="text-foreground select-all truncate block">{item.phone || "—"}</span>
            </div>
            <div className="min-w-0">
              <div className="label-overline mb-0.5">Stack</div>
              <span className="text-foreground truncate block">
                {audit?.tech?.length ? audit.tech.slice(0, 3).join(" · ") : item.tech}
              </span>
            </div>
          </div>

          {audit && status === "audited" && (
            <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {audit.loadTimeMs > 0 && (
                <span><span className="text-foreground font-medium">{(audit.loadTimeMs / 1000).toFixed(2)}s</span> load</span>
              )}
              <span><span className="text-foreground font-medium">{audit.wordCount.toLocaleString()}</span> words</span>
              <span><span className="text-foreground font-medium">{audit.imageCount}</span> images</span>
              {audit.mobileViewport && <span className="text-[#1c7c3a]">✓ Mobile</span>}
              {audit.httpsActive && <span className="text-[#1c7c3a]">✓ HTTPS</span>}
              {audit.jsonLd && <span className="text-[#1c7c3a]">✓ Schema</span>}
              <span className="ml-auto"><SocialIcons socials={audit.socials} /></span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <ScoreRing score={item.stats.score} />
          <div className="text-[10px] uppercase tracking-wider text-(--tertiary-foreground) font-semibold">
            {item.stats.riskLevel}
          </div>
          {onDownloadPDF && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownloadPDF(item); }}
              className="btn btn-ghost btn-sm"
            >
              Audit PDF
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
