"use client";

import React, { useEffect, useState } from "react";
import { Lead, STATUS_OPTIONS, ScoreFactor } from "@/lib/types";
import { useToast } from "@/components/Toast";

interface LeadDetailProps {
  lead: Lead | null;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onNotesSaved: (id: string, notes: string) => void;
  onPurge: (id: string) => void;
  onDownloadPDF: (lead: Lead) => void;
  onQuickStrike: (lead: Lead) => void;
  onLeadRefreshed?: (lead: Lead) => void;
}

const STATUS_TINT: Record<string, string> = {
  NEW:       "bg-[rgba(0,122,255,0.10)] text-[#0040c0]",
  CONTACTED: "bg-[rgba(255,149,0,0.14)] text-[#b15a00]",
  CLOSED:    "bg-[rgba(52,199,89,0.12)] text-[#1c7c3a]",
  REJECTED:  "bg-[rgba(255,59,48,0.10)] text-[#b1251d]",
};

function ScoreFactorRow({ f }: { f: ScoreFactor }) {
  return (
    <li className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
            f.ok ? "bg-[rgba(52,199,89,0.15)] text-[#1c7c3a]" : "bg-[rgba(255,59,48,0.10)] text-[#b1251d]"
          }`}
          aria-hidden
        >
          {f.ok ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          )}
        </span>
        <span className="text-sm text-foreground truncate">{f.label}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {f.value && (
          <span className="text-xs text-(--tertiary-foreground) font-mono tabular-nums">{f.value}</span>
        )}
        <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
          {f.awarded}/{f.weight}
        </span>
      </div>
    </li>
  );
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card-flat p-4">
      <div className="label-overline mb-1">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

const SOCIAL_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn",
  twitter: "Twitter / X", tiktok: "TikTok", youtube: "YouTube",
};

export function LeadDetail({
  lead, onClose, onStatusChange, onNotesSaved, onPurge, onDownloadPDF, onQuickStrike, onLeadRefreshed,
}: LeadDetailProps) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reauditing, setReauditing] = useState(false);
  const toast = useToast();

  const reaudit = async () => {
    if (!lead) return;
    setReauditing(true);
    toast.push("Re-auditing lead… this can take ~30s", "info");
    try {
      const res = await fetch(`/api/leads/${lead.id}/reaudit`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Re-audit failed");
      }
      const json = await res.json();
      if (json.lead && onLeadRefreshed) onLeadRefreshed(json.lead);
      toast.push("Audit refreshed", "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Re-audit failed", "error");
    } finally {
      setReauditing(false);
    }
  };

  useEffect(() => {
    setNotes(lead?.notes ?? "");
    setDirty(false);
  }, [lead?.id, lead?.notes]);

  useEffect(() => {
    if (!lead) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead) return null;

  const audit = lead.audit;
  const factors = lead.scoreFactors ?? [];
  const score = lead.stats.score;
  const tone = score >= 70 ? "score-good" : score >= 40 ? "score-mid" : "score-bad";
  const websiteStatus = lead.websiteStatus ?? (audit?.reachable ? "audited" : "none");
  const externalUrl = lead.websiteFromMaps || (audit?.finalUrl && audit.finalUrl !== "No website detected" ? audit.finalUrl : null);
  const lastAudited = lead.lastAuditedAt ? new Date(lead.lastAuditedAt) : null;

  const saveNotes = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error("Save failed");
      onNotesSaved(String(lead.id), notes);
      setDirty(false);
      toast.push("Notes saved", "success");
    } catch {
      toast.push("Couldn't save notes", "error");
    } finally {
      setSaving(false);
    }
  };

  const altRatio = audit && audit.imageCount > 0 ? Math.round((audit.imagesWithAlt / audit.imageCount) * 100) : null;

  return (
    <div
      className="fixed inset-0 z-150 bg-black/30 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 h-full w-full max-w-2xl bg-card border-l border-border overflow-y-auto animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card/90 backdrop-blur-md border-b border-border px-7 py-5 flex justify-between items-start z-10">
          <div className="min-w-0 pr-4">
            <div className="label-overline mb-1">Lead</div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground truncate">{lead.name}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`chip ${STATUS_TINT[lead.status || "NEW"]}`}>
                <span className={`status-dot status-${(lead.status || "NEW").toLowerCase()}`} />
                {lead.status || "NEW"}
              </span>
              {lead.tech && <span className="chip">{lead.tech}</span>}
              {lead.rating > 0 && <span className="chip">★ {lead.rating}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-muted hover:bg-foreground hover:text-white flex items-center justify-center text-muted-foreground transition-colors shrink-0"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="p-7 space-y-7">
          {/* Score hero */}
          <div className="card p-6">
            <div className="flex items-start gap-6">
              {websiteStatus === "audited" ? (
                <div className={`w-24 h-24 rounded-full ${tone} flex flex-col items-center justify-center shrink-0`}>
                  <span className="text-3xl font-semibold tabular-nums">{score}</span>
                  <span className="text-[10px] uppercase tracking-wider opacity-70 mt-0.5">/ 100</span>
                </div>
              ) : (
                <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-3xl text-(--tertiary-foreground)">—</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="label-overline">Audit</div>
                {websiteStatus === "audited" && (
                  <>
                    <div className="label-section mb-1">{lead.stats.riskLevel} risk</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Based on {factors.length} signals across SEO, performance, mobile and social.
                    </p>
                  </>
                )}
                {websiteStatus === "unreachable" && (
                  <>
                    <div className="label-section mb-1 text-[#b15a00]">Site exists, audit blocked</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      We found a website on Google Maps but couldn&apos;t reach it from our server
                      {lead.websiteFailReason ? ` (${lead.websiteFailReason})` : ""}.
                      Common causes: bot protection (Cloudflare), Wix/Squarespace blocking, or the site is down.
                    </p>
                    {externalUrl && (
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline mt-2 inline-block break-all"
                      >
                        {externalUrl} ↗
                      </a>
                    )}
                  </>
                )}
                {websiteStatus === "none" && (
                  <>
                    <div className="label-section mb-1 text-[#b1251d]">No website detected</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Google Maps doesn&apos;t list a website for this business. They may have one elsewhere
                      that isn&apos;t linked from their listing.
                    </p>
                  </>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    onClick={reaudit}
                    disabled={reauditing}
                    className="btn btn-secondary btn-sm"
                  >
                    {reauditing ? (
                      <>
                        <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                        Re-auditing…
                      </>
                    ) : "Re-audit"}
                  </button>
                  {lastAudited && (
                    <span className="text-xs text-(--tertiary-foreground)">
                      Last audited {lastAudited.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Quick stats */}
          {audit && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile
                label="Load time"
                value={audit.loadTimeMs > 0 ? `${(audit.loadTimeMs / 1000).toFixed(2)}s` : "—"}
                sub={audit.loadTimeMs > 0 && audit.loadTimeMs < 3000 ? "Fast" : audit.loadTimeMs > 0 ? "Could be faster" : undefined}
              />
              <StatTile label="Words" value={audit.wordCount.toLocaleString()} />
              <StatTile
                label="Images"
                value={audit.imageCount}
                sub={altRatio !== null ? `${altRatio}% with alt` : undefined}
              />
              <StatTile
                label="Links"
                value={audit.internalLinks + audit.externalLinks}
                sub={`${audit.internalLinks} int · ${audit.externalLinks} ext`}
              />
            </div>
          )}

          {/* SEO breakdown */}
          {factors.length > 0 && (
            <section>
              <h3 className="label-section mb-3">SEO breakdown</h3>
              <div className="card p-5">
                <ul className="divide-y divide-border">
                  {factors.map((f, i) => <ScoreFactorRow key={i} f={f} />)}
                </ul>
              </div>
            </section>
          )}

          {/* Tech */}
          {audit && audit.tech.length > 0 && (
            <section>
              <h3 className="label-section mb-3">Stack</h3>
              <div className="card p-5">
                <div className="flex flex-wrap gap-2">
                  {audit.tech.map(t => <span key={t} className="chip">{t}</span>)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  <Tag ok={audit.hasGoogleAnalytics} label="Analytics" />
                  <Tag ok={audit.hasGoogleTagManager} label="Tag Manager" />
                  <Tag ok={audit.hasFacebookPixel} label="Meta Pixel" />
                  <Tag ok={audit.hasHubSpot} label="HubSpot" />
                </div>
              </div>
            </section>
          )}

          {/* Communication */}
          <section>
            <h3 className="label-section mb-3">Contact</h3>
            <div className="card p-5 space-y-3 text-sm">
              <Row label="Website" value={
                websiteStatus === "audited" && audit
                  ? <a href={audit.finalUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all block">{audit.finalUrl}</a>
                  : websiteStatus === "unreachable" && externalUrl
                  ? <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-[#b15a00] hover:underline break-all block">{externalUrl} ↗</a>
                  : <span className="text-muted-foreground">Not detected on Google Maps</span>
              } />
              <Row label="Email" value={<span className="select-all">{lead.email}</span>} />
              <Row label="Phone" value={lead.phone || "—"} />
              <Row label="Address" value={lead.address || "—"} />
              {audit && audit.emails.length > 1 && (
                <Row label="Other emails" value={
                  <div className="flex flex-wrap gap-1.5">
                    {audit.emails.slice(1).map(e => <span key={e} className="chip">{e}</span>)}
                  </div>
                } />
              )}
              {audit && audit.phones.length > 0 && (
                <Row label="Phones on site" value={
                  <div className="flex flex-wrap gap-1.5">
                    {audit.phones.map(p => <span key={p} className="chip">{p}</span>)}
                  </div>
                } />
              )}
              <Row label="Maps" value={
                <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View on Google Maps →</a>
              } />
            </div>
          </section>

          {/* Socials */}
          {audit && Object.values(audit.socials).some(Boolean) && (
            <section>
              <h3 className="label-section mb-3">Social</h3>
              <div className="card p-5 grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(audit.socials).map(([k, v]) => v ? (
                  <a
                    key={k}
                    href={v}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-(--radius) bg-muted hover:bg-foreground hover:text-white transition-colors text-sm"
                  >
                    <span className="font-medium">{SOCIAL_LABEL[k]}</span>
                    <span className="text-xs opacity-70">↗</span>
                  </a>
                ) : null)}
              </div>
            </section>
          )}

          {/* Status */}
          <section>
            <h3 className="label-section mb-3">Status</h3>
            <div className="grid grid-cols-4 gap-2">
              {STATUS_OPTIONS.map((option) => {
                const active = (lead.status || "NEW") === option;
                return (
                  <button
                    key={option}
                    onClick={() => onStatusChange(String(lead.id), option)}
                    className={`px-3 py-2.5 text-sm font-medium rounded-(--radius) transition-all cursor-pointer ${
                      active ? "bg-foreground text-white" : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option.charAt(0) + option.slice(1).toLowerCase()}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Notes */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="label-section">Notes</h3>
              <button
                onClick={saveNotes}
                disabled={!dirty || saving}
                className={`btn btn-sm ${dirty && !saving ? "btn-accent" : "btn-secondary"}`}
              >
                {saving ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </div>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              placeholder="Add context, conversation history, follow-up dates…"
              className="input min-h-[120px] resize-y leading-relaxed"
            />
          </section>

          {/* Pitch */}
          {lead.pitch && (
            <section>
              <h3 className="label-section mb-3">Suggested pitch</h3>
              <div className="card p-5">
                <p className="text-sm text-foreground leading-relaxed">{lead.pitch}</p>
                <button
                  onClick={() => { navigator.clipboard.writeText(lead.pitch); toast.push("Pitch copied", "success"); }}
                  className="btn btn-ghost btn-sm mt-3 -ml-3"
                >
                  Copy pitch
                </button>
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button onClick={() => onQuickStrike(lead)} className="btn btn-accent">
              Send email
            </button>
            <button onClick={() => onDownloadPDF(lead)} className="btn btn-secondary">
              Download audit PDF
            </button>
            <button onClick={() => window.open(lead.mapsUrl, "_blank")} className="btn btn-secondary">
              Open in Maps
            </button>
            <button onClick={() => onPurge(String(lead.id))} className="btn btn-danger">
              Delete lead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
      <span className="text-xs text-muted-foreground sm:w-32 shrink-0 uppercase tracking-wider font-medium">{label}</span>
      <div className="text-sm text-foreground min-w-0 flex-1">{value}</div>
    </div>
  );
}

function Tag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${ok ? "text-foreground" : "text-(--tertiary-foreground)"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-[#34c759]" : "bg-[#d2d2d7]"}`} />
      {label}
    </div>
  );
}
