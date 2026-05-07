"use client";

import React, { useEffect, useState } from "react";
import { Lead, STATUS_OPTIONS } from "@/lib/types";
import { useToast } from "@/components/Toast";

interface LeadDetailProps {
  lead: Lead | null;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onNotesSaved: (id: string, notes: string) => void;
  onPurge: (id: string) => void;
  onDownloadPDF: (lead: Lead) => void;
  onQuickStrike: (lead: Lead) => void;
}

export function LeadDetail({
  lead, onClose, onStatusChange, onNotesSaved, onPurge, onDownloadPDF, onQuickStrike,
}: LeadDetailProps) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setNotes(lead?.notes ?? "");
    setDirty(false);
  }, [lead?.id, lead?.notes]);

  useEffect(() => {
    if (!lead) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead) return null;

  const saveNotes = async () => {
    if (!lead) return;
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
      toast.push("Intel update committed.", "success");
    } catch {
      toast.push("Notes sync failed.", "error");
    } finally {
      setSaving(false);
    }
  };

  const scoreColor =
    lead.stats.score >= 70 ? "text-emerald-400" :
    lead.stats.score >= 40 ? "text-primary" : "text-rose-500";

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="absolute right-0 top-0 h-full w-full max-w-2xl bg-zinc-950 border-l-2 border-primary overflow-y-auto animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur-md border-b border-border px-6 py-4 flex justify-between items-center z-10">
          <div>
            <div className="text-[9px] font-mono text-primary uppercase tracking-widest">
              Target Dossier
            </div>
            <div className="text-xl font-black text-white uppercase tracking-tighter truncate max-w-[400px]">
              {lead.name}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white text-2xl font-black px-2 cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex gap-4 items-stretch">
            <div className="card-bento flex-1 p-4">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">
                Efficiency Score
              </div>
              <div className={`text-5xl font-black font-mono tracking-tighter ${scoreColor}`}>
                {lead.stats.score}%
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1">
                {lead.stats.riskLevel.toUpperCase()}
              </div>
            </div>
            <div className="card-bento flex-1 p-4">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">
                Maps Authority
              </div>
              <div className="text-5xl font-black font-mono tracking-tighter text-white">
                {lead.rating || "—"}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1">
                ★ RATING / {lead.reviews || "0"} REVIEWS
              </div>
            </div>
            <div className="card-bento flex-1 p-4">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-1">
                Tech Stack
              </div>
              <div className="text-2xl font-black font-mono tracking-tighter text-white pt-2">
                {lead.tech}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-1">
                {lead.isSocialUrl ? "SOCIAL ONLY" : lead.url === "No Website Detected" ? "NO SITE" : "WEB ASSET"}
              </div>
            </div>
          </div>

          <div className="card-bento p-5">
            <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-3">
              Status Control
            </div>
            <div className="grid grid-cols-4 gap-2">
              {STATUS_OPTIONS.map((option) => {
                const active = (lead.status || "NEW") === option;
                return (
                  <button
                    key={option}
                    onClick={() => onStatusChange(String(lead.id), option)}
                    className={`px-2 py-2 text-[10px] font-black uppercase border transition-all cursor-pointer ${
                      active
                        ? "bg-primary text-black border-primary"
                        : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-primary"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="card-bento p-4">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">
                Comms Channel
              </div>
              <div className="text-xs font-mono text-white break-all select-all">
                {lead.email}
              </div>
            </div>
            <div className="card-bento p-4">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">
                Phone
              </div>
              <div className="text-xs font-mono text-white break-all select-all">
                {lead.phone || "—"}
              </div>
            </div>
            <div className="card-bento p-4 col-span-2">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">
                Web Asset
              </div>
              {lead.url && lead.url !== "No Website Detected" ? (
                <a
                  href={lead.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-primary hover:underline break-all"
                >
                  {lead.url}
                </a>
              ) : (
                <span className="text-xs font-mono text-rose-500">No website detected</span>
              )}
            </div>
            <div className="card-bento p-4 col-span-2">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">
                Coordinates
              </div>
              <div className="text-xs font-mono text-zinc-300 mb-2">{lead.address || "—"}</div>
              <a
                href={lead.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-mono text-primary hover:underline"
              >
                View on Google Maps →
              </a>
            </div>
          </div>

          <div className="card-bento p-5">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                Field Notes
              </div>
              <button
                onClick={saveNotes}
                disabled={!dirty || saving}
                className={`text-[10px] font-black uppercase px-3 py-1.5 transition-all ${
                  dirty && !saving
                    ? "bg-primary text-black cursor-pointer hover:bg-white"
                    : "bg-zinc-900 text-zinc-600 cursor-not-allowed"
                }`}
              >
                {saving ? "Syncing..." : dirty ? "Commit" : "Synced"}
              </button>
            </div>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
              placeholder="Decryption attempts, contact log, key insights..."
              className="w-full h-32 bg-black border border-border text-zinc-200 font-mono text-xs p-3 resize-none focus:border-primary focus:outline-none"
            />
          </div>

          <div className="card-bento p-5">
            <div className="text-[9px] font-black text-muted-foreground uppercase tracking-widest mb-2">
              Suggested Pitch
            </div>
            <p className="text-zinc-400 text-[12px] italic leading-relaxed border-l-2 border-zinc-800 pl-4">
              &ldquo;{lead.pitch}&rdquo;
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(lead.pitch);
                toast.push("Pitch copied to clipboard.", "success");
              }}
              className="mt-3 text-[10px] font-black uppercase text-zinc-500 hover:text-primary cursor-pointer"
            >
              [ Copy Pitch ]
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              onClick={() => onQuickStrike(lead)}
              className="bg-primary text-black px-4 py-3 text-[10px] font-black uppercase hover:bg-white transition-all cursor-pointer"
            >
              Quick Strike (Email)
            </button>
            <button
              onClick={() => onDownloadPDF(lead)}
              className="bg-zinc-800 text-white px-4 py-3 text-[10px] font-black uppercase hover:bg-zinc-700 transition-all cursor-pointer"
            >
              Extract Audit Report
            </button>
            <button
              onClick={() => window.open(lead.mapsUrl, "_blank")}
              className="bg-zinc-900 border border-zinc-800 text-zinc-400 px-4 py-3 text-[10px] font-black uppercase hover:text-white hover:border-white transition-all cursor-pointer"
            >
              View Coordinates
            </button>
            <button
              onClick={() => onPurge(String(lead.id))}
              className="border border-rose-900 text-rose-500 px-4 py-3 text-[10px] font-black uppercase hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
            >
              Purge Target
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
