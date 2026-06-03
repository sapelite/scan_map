"use client";

import React, { useEffect, useState } from "react";
import { Lead, STATUS_OPTIONS, ScoreFactor, DimensionBreakdown, OPPORTUNITY_META } from "@/lib/types";
import { ScoreBadge, opportunityLabel, scoreHex } from "@/components/Presence";
import { buildWhatsApp, buildEmail, waRecipient } from "@/lib/outreach";
import { useToast } from "@/components/Toast";

interface LeadDetailProps {
  lead: Lead | null;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onNotesSaved: (id: string, notes: string) => void;
  onPurge: (id: string) => void;
  onDownloadPDF: (lead: Lead, mode?: "client" | "admin") => void;
  onQuickStrike: (lead: Lead) => void;
  onLeadRefreshed?: (lead: Lead) => void;
}

const STATUS_LABEL = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function ScoreFactorRow({ f }: { f: ScoreFactor }) {
  return (
    <li className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`status-dot ${f.ok ? "bg-[#0E9F6E]" : "bg-[#DC2626]"}`} aria-hidden />
        <span className="text-sm text-foreground truncate">{f.label}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {f.value && <span className="text-xs text-tertiary-foreground font-mono tabular-nums" style={{ color: "var(--tertiary-foreground)" }}>{f.value}</span>}
        <span className="text-xs text-muted-foreground tabular-nums w-9 text-right font-mono">{f.awarded}/{f.weight}</span>
      </div>
    </li>
  );
}

function DimensionPanel({ d }: { d: DimensionBreakdown }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-baseline gap-2">
          <span className="label-section">{d.label}</span>
          <span className="panel-meta">{d.weight}% of score</span>
        </div>
        <span className="text-lg font-semibold tabular-nums" style={{ color: scoreHex(d.score) }}>{d.score}</span>
      </div>
      <div className="meter mb-2"><span style={{ width: `${d.score}%`, background: scoreHex(d.score) }} /></div>
      <p className="text-xs text-muted-foreground mb-3">{d.blurb}</p>
      <ul className="divide-y divide-border">
        {d.factors.map((f, i) => <ScoreFactorRow key={i} f={f} />)}
      </ul>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card-flat p-3.5">
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
  const [deepAuditing, setDeepAuditing] = useState(false);
  const [waMsg, setWaMsg] = useState("");
  const [emailSubj, setEmailSubj] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const toast = useToast();

  const runAudit = async (deep: boolean): Promise<Lead | null> => {
    if (!lead) return null;
    const setBusy = deep ? setDeepAuditing : setReauditing;
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/${deep ? "deep-audit" : "reaudit"}`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Audit failed");
      }
      const json = await res.json();
      if (json.lead && onLeadRefreshed) onLeadRefreshed(json.lead);
      if (deep) toast.push(`Deep audit done · crawled ${json.lead?.audit?.pagesCrawled ?? 1} page(s)`, "success");
      return (json.lead as Lead) ?? null;
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed", "error");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const reaudit = () => runAudit(false);
  const deepAudit = () => runAudit(true);
  // One-click: crawl the site deeply, then generate the client report from the fresh data.
  const deepAuditAndReport = async () => {
    const fresh = await runAudit(true);
    if (fresh) onDownloadPDF(fresh, "client");
  };

  useEffect(() => {
    setNotes(lead?.notes ?? "");
    setDirty(false);
  }, [lead?.id, lead?.notes]);

  useEffect(() => {
    if (!lead) return;
    setWaMsg(buildWhatsApp(lead));
    const e = buildEmail(lead);
    setEmailSubj(e.subject);
    setEmailBody(e.body);
  }, [lead?.id]);

  useEffect(() => {
    if (!lead) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead) return null;

  const audit = lead.audit;
  const score = lead.stats.score;
  const websiteStatus = lead.websiteStatus ?? (audit?.reachable ? "audited" : "none");
  const externalUrl = lead.websiteFromMaps || (audit?.finalUrl && audit.finalUrl !== "No website detected" ? audit.finalUrl : null);
  const lastAudited = lead.lastAuditedAt ? new Date(lead.lastAuditedAt) : null;
  const dimFactors = lead.dimensionFactors ?? [];
  const opps = lead.opportunities ?? [];

  const recipient = waRecipient(lead);
  const waHref = recipient ? `https://wa.me/${recipient}?text=${encodeURIComponent(waMsg)}` : null;
  const validEmail = lead.email && !/^no email/i.test(lead.email);
  const mailHref = validEmail ? `mailto:${lead.email}?subject=${encodeURIComponent(emailSubj)}&body=${encodeURIComponent(emailBody)}` : null;
  const copyText = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.push(`${label} copied`, "success"); };

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
    } catch {
      toast.push("Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const altRatio = audit && audit.imageCount > 0 ? Math.round((audit.imagesWithAlt / audit.imageCount) * 100) : null;

  return (
    <div className="fixed inset-0 z-150 bg-black/20 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-2xl bg-background border-l border-border overflow-y-auto animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background/90 backdrop-blur-md border-b border-border px-7 py-5 flex justify-between items-start z-10">
          <div className="min-w-0 pr-4">
            <div className="label-overline mb-1">{lead.category || "Lead"}</div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground truncate">{lead.name}</h2>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="chip">
                <span className={`status-dot status-${(lead.status || "NEW").toLowerCase()}`} />
                {STATUS_LABEL(lead.status || "NEW")}
              </span>
              {lead.tech && lead.tech !== "Unknown" && <span className="chip">{lead.tech}</span>}
              {lead.rating > 0 && <span className="chip">★ {lead.rating.toFixed(1)} · {lead.reviewCount || 0}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-sm bg-muted hover:bg-foreground hover:text-white flex items-center justify-center text-muted-foreground transition-colors"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
            <span className="panel-meta hidden sm:block whitespace-nowrap">↑ ↓ or J K to move</span>
          </div>
        </div>

        <div className="p-7 space-y-6">
          {/* Score hero */}
          <div className="panel p-6">
            <div className="flex items-center gap-6">
              <div className="shrink-0 text-center">
                <ScoreBadge score={score} size="xl" />
                <div className="label-overline mt-1">presence /100</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold" style={{ color: scoreHex(score) }}>{opportunityLabel(score)}</div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {websiteStatus === "audited" ? "Website audited + presence scored across 5 dimensions."
                    : websiteStatus === "unreachable" ? `Website unreachable${lead.websiteFailReason ? `, ${lead.websiteFailReason}` : ""}.`
                    : "No website on the Google listing, so this is scored on reputation only."}
                </div>
                {externalUrl && websiteStatus !== "audited" && (
                  <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-(--teal-deep) hover:underline mt-1 inline-block break-all">{externalUrl}</a>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button onClick={reaudit} disabled={reauditing || deepAuditing} className="btn btn-secondary btn-sm">
                    {reauditing ? "Re-auditing…" : "Re-audit"}
                  </button>
                  <button onClick={deepAudit} disabled={reauditing || deepAuditing} className="btn btn-primary btn-sm" title="Crawls the homepage + key internal pages (about, contact, services, booking, blog) for more contacts, socials and signals">
                    {deepAuditing ? "Deep auditing…" : "Deep audit"}
                  </button>
                  {audit?.pagesCrawled && audit.pagesCrawled > 1 && (
                    <span className="chip">{audit.pagesCrawled} pages crawled</span>
                  )}
                  {lastAudited && (
                    <span className="text-xs" style={{ color: "var(--tertiary-foreground)" }}>
                      {lastAudited.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Pitch angles: what to sell, why it matters, how to fix */}
          {opps.length > 0 && (
            <section>
              <h3 className="label-section mb-3">What to sell them · why it matters · how to fix</h3>
              <div className="panel divide-y divide-border">
                {opps.map((o) => {
                  const m = OPPORTUNITY_META[o];
                  return (
                    <div key={o} className="p-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="chip shrink-0" style={{ background: "var(--teal-soft)", borderColor: "rgba(13,148,136,0.30)", color: "var(--teal-deep)" }}>{m.sell}</span>
                        <span className="text-sm font-medium text-foreground">{m.long}</span>
                      </div>
                      <p className="text-xs text-muted-foreground"><span className="label-overline mr-1">Why</span>{m.why}</p>
                      <p className="text-xs text-muted-foreground mt-1.5"><span className="label-overline mr-1">Fix</span>{m.fix}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Outreach */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="label-section">Outreach</h3>
              <span className="panel-meta">ready to send, edit as you like</span>
            </div>
            <div className="panel p-5 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="label-overline">WhatsApp message</span>
                  <div className="flex gap-2">
                    <button onClick={() => copyText(waMsg, "Message")} className="btn btn-secondary btn-sm">Copy</button>
                    {waHref ? (
                      <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ background: "#25D366", color: "#06281a" }}>Open WhatsApp</a>
                    ) : (
                      <span className="text-xs text-muted-foreground self-center">No WhatsApp number</span>
                    )}
                  </div>
                </div>
                <textarea value={waMsg} onChange={(e) => setWaMsg(e.target.value)} className="input min-h-24 resize-y leading-relaxed text-sm" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="label-overline">Email</span>
                  <div className="flex gap-2">
                    <button onClick={() => copyText(`${emailSubj}\n\n${emailBody}`, "Email")} className="btn btn-secondary btn-sm">Copy</button>
                    {mailHref ? (
                      <a href={mailHref} className="btn btn-secondary btn-sm">Open email</a>
                    ) : (
                      <span className="text-xs text-muted-foreground self-center">No email on file</span>
                    )}
                  </div>
                </div>
                <input value={emailSubj} onChange={(e) => setEmailSubj(e.target.value)} className="input text-sm mb-2" placeholder="Subject" />
                <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} className="input min-h-32 resize-y leading-relaxed text-sm" />
              </div>
            </div>
          </section>

          {/* Dimension breakdown */}
          {dimFactors.length > 0 && (
            <section>
              <h3 className="label-section mb-3">Presence breakdown</h3>
              <div className="grid grid-cols-1 gap-3">
                {dimFactors.map((d) => <DimensionPanel key={d.key} d={d} />)}
              </div>
            </section>
          )}

          {/* Quick stats */}
          {audit && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Load time" value={audit.loadTimeMs > 0 ? `${(audit.loadTimeMs / 1000).toFixed(2)}s` : "n/a"} sub={audit.loadTimeMs > 0 ? (audit.loadTimeMs < 3000 ? "Fast" : "Slow") : undefined} />
              <StatTile label="Words" value={audit.wordCount.toLocaleString()} />
              <StatTile label="Images" value={audit.imageCount} sub={altRatio !== null ? `${altRatio}% with alt` : undefined} />
              <StatTile label="Socials" value={audit.socialCount ?? 0} sub={`${audit.adPixels?.length ?? 0} ad pixel${(audit.adPixels?.length ?? 0) === 1 ? "" : "s"}`} />
            </div>
          )}

          {/* Marketing & content signals */}
          {audit && (
            <section>
              <h3 className="label-section mb-3">Marketing & content signals</h3>
              <div className="panel p-5 grid grid-cols-2 md:grid-cols-3 gap-y-2.5 gap-x-4">
                <Tag ok={audit.hasGoogleAnalytics || audit.hasGoogleTagManager} label="Analytics" />
                <Tag ok={(audit.adPixels?.length ?? 0) > 0} label={audit.adPixels?.length ? audit.adPixels[0] : "Ad pixel"} />
                <Tag ok={audit.hasEmailCapture} label="Email capture" />
                <Tag ok={audit.hasBooking} label="Online booking" />
                <Tag ok={audit.hasLiveChat} label="Live chat" />
                <Tag ok={audit.hasBlog} label="Blog / news" />
                <Tag ok={audit.hasFacebookPixel} label="Meta Pixel" />
                <Tag ok={audit.jsonLd} label="Schema markup" />
                <Tag ok={audit.mobileViewport} label="Mobile-ready" />
              </div>
            </section>
          )}

          {/* Deep dossier (from a Deep audit) */}
          {lead.deepReport && (() => {
            const d = lead.deepReport!;
            const seoIssues = d.pagesMissingTitle + d.pagesMissingMeta;
            return (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="label-section">Deep dossier</h3>
                  <span className="panel-meta">{new Date(d.ranAt).toLocaleDateString()}</span>
                </div>
                <div className="panel p-5 space-y-4">
                  {/* website crawl */}
                  <div>
                    <div className="label-overline mb-2">Website crawl</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm">
                      <Metric label="Pages crawled" value={`${d.pagesCrawled} / ${d.pagesDiscovered}`} />
                      <Metric label="Sitemap" value={d.sitemapFound ? "found" : "none"} ok={d.sitemapFound} />
                      <Metric label="Homepage weight" value={`${d.pageWeightKb} KB`} />
                      <Metric label="Scripts (home)" value={`${d.scriptCount}`} />
                      <Metric label="Images" value={`${d.totalImages}`} />
                      <Metric label="Pages missing SEO" value={`${seoIssues}`} ok={seoIssues === 0} />
                      <Metric label="Broken links" value={`${d.brokenLinks.length}`} ok={d.brokenLinks.length === 0} />
                      <Metric label="Fresh content" value={d.latestContentDate ? d.latestContentDate : (d.hasFreshContent ? "yes" : "none found")} ok={d.hasFreshContent} />
                    </div>
                    {d.brokenLinks.length > 0 && (
                      <details className="mt-3">
                        <summary className="text-xs text-muted-foreground cursor-pointer">Show {d.brokenLinks.length} broken link(s)</summary>
                        <div className="mt-2 space-y-1 font-mono text-[11px] text-[#DC2626]">
                          {d.brokenLinks.slice(0, 12).map((b, i) => <div key={i} className="truncate">{b}</div>)}
                        </div>
                      </details>
                    )}
                  </div>

                  {/* social accounts */}
                  {d.socials.length > 0 && (
                    <div className="pt-3 border-t border-border">
                      <div className="label-overline mb-2">Social accounts checked</div>
                      <div className="space-y-2">
                        {d.socials.map((s) => (
                          <div key={s.url} className="flex items-start gap-2.5 text-sm">
                            <span className={`status-dot mt-1.5 ${s.live ? "bg-[#0E9F6E]" : ""}`} style={s.live ? undefined : { background: "var(--bad)" }} />
                            <div className="min-w-0 flex-1">
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-(--teal-deep) hover:underline font-medium">{s.platform}</a>
                              {s.note && <span className="text-xs text-muted-foreground"> · {s.note}</span>}
                              {s.title && <div className="text-xs text-muted-foreground truncate">{s.title}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-2.5">
                        Best-effort: Instagram, Facebook, TikTok and LinkedIn limit what they show without logging in, so this confirms the account is live and grabs any public info, not full analytics.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            );
          })()}

          {/* Tech */}
          {audit && audit.tech.length > 0 && (
            <section>
              <h3 className="label-section mb-3">Stack</h3>
              <div className="panel p-5 flex flex-wrap gap-2">
                {audit.tech.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
            </section>
          )}

          {/* Contact */}
          <section>
            <h3 className="label-section mb-3">Contact</h3>
            <div className="panel p-5 space-y-3 text-sm">
              <Row label="Website" value={
                websiteStatus === "audited" && audit
                  ? <a href={audit.finalUrl} target="_blank" rel="noopener noreferrer" className="text-(--teal-deep) hover:underline break-all block">{audit.finalUrl}</a>
                  : externalUrl
                  ? <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-(--teal-deep) hover:underline break-all block">{externalUrl}</a>
                  : <span className="text-muted-foreground">None</span>
              } />
              <Row label="Email" value={lead.email && lead.email !== "No email found" ? <span className="select-all">{lead.email}</span> : <span className="text-muted-foreground">None</span>} />
              <Row label="Phone" value={lead.phone && lead.phone !== "No Phone" ? lead.phone : <span className="text-muted-foreground">None</span>} />
              <Row label="WhatsApp" value={
                (lead.whatsapp || audit?.whatsapp)
                  ? (() => {
                      const wa = (lead.whatsapp || audit?.whatsapp) as string;
                      const href = wa.startsWith("http") ? wa : `https://wa.me/${wa.replace(/[^\d+]/g, "")}`;
                      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#0E9F6E] hover:underline break-all">{wa}</a>;
                    })()
                  : <span className="text-muted-foreground">None</span>
              } />
              <Row label="Address" value={lead.address && lead.address !== "No Address" ? lead.address : <span className="text-muted-foreground">None</span>} />
              {audit && audit.emails.length > 1 && (
                <Row label="Other emails" value={<div className="flex flex-wrap gap-1.5">{audit.emails.slice(1).map((e) => <span key={e} className="chip">{e}</span>)}</div>} />
              )}
              {audit && audit.phones.length > 0 && (
                <Row label="Phones on site" value={<div className="flex flex-wrap gap-1.5">{audit.phones.map((p) => <span key={p} className="chip">{p}</span>)}</div>} />
              )}
              <Row label="Maps" value={<a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-(--teal-deep) hover:underline">Open in Google Maps</a>} />
            </div>
          </section>

          {/* Socials */}
          {audit && Object.values(audit.socials).some(Boolean) && (
            <section>
              <h3 className="label-section mb-3">Social</h3>
              <div className="panel p-5 grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(audit.socials).map(([k, v]) => v ? (
                  <a key={k} href={v} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-sm bg-muted hover:bg-foreground hover:text-white transition-colors text-sm font-medium">
                    {SOCIAL_LABEL[k]}
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
                    className={`px-3 py-2.5 text-sm font-medium rounded-sm transition-all cursor-pointer ${active ? "bg-foreground text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
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
              <button onClick={saveNotes} disabled={!dirty || saving} className={`btn btn-sm ${dirty && !saving ? "btn-primary" : "btn-secondary"}`}>
                {saving ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
            </div>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              placeholder="Outreach notes, who you spoke to, next steps…"
              className="input min-h-30 resize-y leading-relaxed"
            />
          </section>

          {/* Audit attempt log */}
          {lead.auditAttempts && lead.auditAttempts.length > 0 && (
            <details className="panel p-5 group">
              <summary className="cursor-pointer flex items-center justify-between list-none">
                <h3 className="label-section">Audit log</h3>
                <span className="text-xs text-muted-foreground">{lead.auditAttempts.length} entries</span>
              </summary>
              <div className="mt-3 space-y-1 font-mono text-[11px] leading-relaxed">
                {lead.auditAttempts.map((a, i) => {
                  const ok = / OK \(/.test(a);
                  return (
                    <div key={i} className={ok ? "text-[#0E9F6E]" : "text-muted-foreground"}>
                      <span style={{ color: "var(--tertiary-foreground)" }} className="mr-2">{String(i + 1).padStart(2, "0")}</span>
                      {a}
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Actions */}
          <button
            onClick={deepAuditAndReport}
            disabled={reauditing || deepAuditing}
            className="btn btn-primary w-full mt-2"
            title="Crawl their site deeply for the freshest data, then download a client-ready PDF"
          >
            {deepAuditing ? "Deep auditing, then building PDF…" : "Deep audit + Client PDF"}
          </button>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button onClick={() => onQuickStrike(lead)} className="btn btn-secondary">Email</button>
            {(lead.whatsapp || audit?.whatsapp) && (
              <a
                href={(() => {
                  const wa = (lead.whatsapp || audit?.whatsapp) as string;
                  return wa.startsWith("http") ? wa : `https://wa.me/${wa.replace(/[^\d+]/g, "")}`;
                })()}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ background: "#25D366", color: "#06281a" }}
              >
                WhatsApp
              </a>
            )}
            <button onClick={() => onDownloadPDF(lead, "client")} className="btn btn-secondary" title="Branded report to send to the business">Client PDF</button>
            <button onClick={() => onDownloadPDF(lead, "admin")} className="btn btn-secondary" title="Internal report with scores + sales angles">Internal PDF</button>
            <button onClick={() => window.open(lead.mapsUrl, "_blank")} className="btn btn-secondary">Open in Maps</button>
            <button onClick={() => onPurge(String(lead.id))} className="btn btn-danger">Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
      <span className="label-overline sm:w-32 shrink-0">{label}</span>
      <div className="text-sm text-foreground min-w-0 flex-1">{value}</div>
    </div>
  );
}

function Metric({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums" style={ok === undefined ? undefined : { color: ok ? "var(--good)" : "var(--bad)" }}>{value}</div>
    </div>
  );
}

function Tag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${ok ? "text-foreground" : "text-muted-foreground"}`}>
      <span className={`status-dot ${ok ? "bg-[#0E9F6E]" : ""}`} style={ok ? undefined : { background: "var(--tertiary-foreground)" }} />
      {label}
    </div>
  );
}
