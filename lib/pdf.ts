import jsPDF from "jspdf";
import { Lead, OPPORTUNITY_META, PresenceKey } from "@/lib/types";
import { BRAND as CUSTOMY } from "@/lib/brand";

// ---- palette (RGB) ----
const TEAL: [number, number, number] = [13, 148, 136];
const INK: [number, number, number] = [19, 28, 26];
const MUTED: [number, number, number] = [110, 116, 113];
const LINE: [number, number, number] = [225, 228, 225];
const GOOD: [number, number, number] = [14, 159, 110];
const MID: [number, number, number] = [194, 113, 12];
const BAD: [number, number, number] = [220, 38, 38];

const W = 210, H = 297, M = 18;
const scoreRGB = (s: number): [number, number, number] => (s >= 70 ? GOOD : s >= 40 ? MID : BAD);

export interface BenchmarkInfo {
  label: string;   // e.g. "Top villas in Canggu"
  score: number;   // peer benchmark 0-100
  basis: string;   // e.g. "based on 8 villas audited" or "industry benchmark"
}
export interface PdfOpts { benchmark?: BenchmarkInfo }

const DIM_KEYS: PresenceKey[] = ["site", "social", "marketing", "reputation", "content"];
const DIM_LABEL: Record<PresenceKey, string> = {
  site: "Website", social: "Social media", marketing: "Marketing", reputation: "Reputation", content: "Content",
};

const fileName = (item: Lead, kind: string) =>
  `${kind}_${item.name.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40)}.pdf`;

// shared small helpers --------------------------------------------------------
function heading(doc: jsPDF, text: string, y: number) {
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(text, M, y); y += 4;
  doc.setDrawColor(...LINE); doc.line(M, y, W - M, y);
  return y + 6;
}
function ensure(doc: jsPDF, y: number, need = 16) {
  if (y + need > H - 16) { doc.addPage(); return M + 4; }
  return y;
}
function footer(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text("Customy · Bali web, social and marketing studio", M, H - 10);
    doc.text(`${i} / ${pages}`, W - M, H - 10, { align: "right" });
  }
}
function dimensionBars(doc: jsPDF, dims: Record<PresenceKey, number>, y: number) {
  const barX = M + 34, barW = W - M - barX - 14;
  for (const k of DIM_KEYS) {
    const v = dims[k] ?? 0;
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(DIM_LABEL[k], M, y + 3);
    doc.setFillColor(238, 240, 238); doc.roundedRect(barX, y, barW, 3.2, 1.6, 1.6, "F");
    doc.setFillColor(...scoreRGB(v)); doc.roundedRect(barX, y, Math.max((barW * v) / 100, 1.5), 3.2, 1.6, 1.6, "F");
    doc.setTextColor(...scoreRGB(v)); doc.setFont("helvetica", "bold");
    doc.text(`${v}`, W - M, y + 3, { align: "right" });
    y += 8;
  }
  return y + 2;
}
function interpretation(score: number) {
  if (score < 35) return "Lots of room to grow, which means lots of upside from a focused push.";
  if (score < 60) return "A solid base with several clear, high-impact opportunities.";
  if (score < 80) return "Good presence overall. A few targeted fixes will lift results.";
  return "Excellent presence. Mostly fine-tuning from here.";
}

// A red→amber→green scale with a marker at the score.
function scoreScale(doc: jsPDF, score: number, y: number) {
  const x = M, w = W - 2 * M, h = 4;
  doc.setFillColor(...BAD); doc.rect(x, y, w * 0.4, h, "F");
  doc.setFillColor(...MID); doc.rect(x + w * 0.4, y, w * 0.3, h, "F");
  doc.setFillColor(...GOOD); doc.rect(x + w * 0.7, y, w * 0.3, h, "F");
  const mx = x + (w * Math.min(Math.max(score, 0), 100)) / 100;
  doc.setFillColor(...INK); doc.triangle(mx, y - 0.5, mx - 2.4, y - 5, mx + 2.4, y - 5, "F");
  doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text("0", x, y + h + 4); doc.text("50", x + w / 2, y + h + 4, { align: "center" }); doc.text("100", x + w, y + h + 4, { align: "right" });
  return y + h + 9;
}

// "You" vs peer benchmark bars.
function benchmarkBars(doc: jsPDF, you: number, peer: number, peerLabel: string, y: number) {
  const labelW = 46, barX = M + labelW, barW = W - M - barX - 12;
  const row = (label: string, val: number, color: [number, number, number], yy: number) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(label, labelW - 2), M, yy + 3);
    doc.setFillColor(238, 240, 238); doc.roundedRect(barX, yy, barW, 4.5, 2, 2, "F");
    doc.setFillColor(...color); doc.roundedRect(barX, yy, Math.max((barW * val) / 100, 2.5), 4.5, 2, 2, "F");
    doc.setTextColor(...color); doc.setFont("helvetica", "bold"); doc.text(`${val}`, W - M, yy + 3.4, { align: "right" });
    return yy + 10;
  };
  y = row("You", you, scoreRGB(you), y);
  y = row(peerLabel, peer, GOOD, y);
  return y;
}

// =============================================================================
// CLIENT REPORT: branded, customer-facing, positive and consultative
// =============================================================================
function verdict(score: number) {
  if (score < 40) return "Right now you're losing customers to better-presented competitors, but it's very fixable.";
  if (score < 60) return "You've got a foundation, but real bookings are slipping through the gaps below.";
  if (score < 80) return "You're doing well. A few targeted moves will turn browsers into bookings.";
  return "You're ahead of most. Let's sharpen the edges and protect your lead.";
}

function buildClientPdf(item: Lead, opts?: PdfOpts) {
  const doc = new jsPDF();
  let y = M;
  const score = item.stats.score;
  const sc = scoreRGB(score);
  const opps = item.opportunities ?? [];

  // ---- header ----
  doc.setFillColor(...TEAL); doc.rect(0, 0, W, 6, "F");
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text("PREPARED FOR", M, y + 6);
  doc.text(new Date().toLocaleDateString(undefined, { dateStyle: "medium" }), W - M, y + 6, { align: "right" });
  y += 13;
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(21);
  const nameLines = doc.splitTextToSize(item.name, W - 2 * M); doc.text(nameLines, M, y); y += nameLines.length * 8;
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Digital Presence Audit${item.category ? "  ·  " + item.category : ""}`, M, y); y += 9;

  // ---- verdict headline ----
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  const vLines = doc.splitTextToSize(verdict(score), W - 2 * M); doc.text(vLines, M, y); y += vLines.length * 6 + 4;

  // ---- score panel + scale ----
  doc.setFillColor(247, 249, 248); doc.roundedRect(M, y, W - 2 * M, 30, 2, 2, "F");
  doc.setTextColor(...sc); doc.setFont("helvetica", "bold"); doc.setFontSize(30);
  doc.text(`${score}`, M + 9, y + 20);
  const numW = doc.getTextWidth(`${score}`);
  doc.setTextColor(...MUTED); doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text("/100", M + 11 + numW, y + 20);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("Your Digital Presence Score", M + 46, y + 12);
  doc.setTextColor(60, 66, 63); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(doc.splitTextToSize(interpretation(score), W - 2 * M - 52), M + 46, y + 19);
  y += 38;
  y = scoreScale(doc, score, y) + 2;

  // ---- benchmark (the urgency lever) ----
  const bm = opts?.benchmark;
  if (bm) {
    y = ensure(doc, y, 34);
    y = heading(doc, "How you compare", y);
    y = benchmarkBars(doc, score, bm.score, bm.label, y) + 1;
    const gap = Math.max(bm.score - score, 0);
    const art = (() => { const s = String(gap); return (s[0] === "8" || s === "11" || s === "18") ? "an" : "a"; })();
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
    const gapMsg = gap >= 8
      ? `That's ${art} ${gap}-point gap, and that gap is the difference between getting found and booked or being passed over. ${bm.basis}`
      : `You're keeping pace with the best in your market. ${bm.basis}`;
    doc.text(doc.splitTextToSize(gapMsg, W - 2 * M), M, y); y += doc.splitTextToSize(gapMsg, W - 2 * M).length * 4.4 + 6;
  }

  // ---- dimensions ----
  if (item.stats.dimensions) {
    y = ensure(doc, y, 60);
    y = heading(doc, "Where you stand, dimension by dimension", y);
    y = dimensionBars(doc, item.stats.dimensions, y) + 2;
  }

  // ---- strengths ----
  const strengths: string[] = [];
  if (item.stats.dimensions) for (const k of DIM_KEYS) if ((item.stats.dimensions[k] ?? 0) >= 70) strengths.push(`Strong ${DIM_LABEL[k].toLowerCase()}`);
  if (item.rating >= 4.3 && item.reviewCount >= 20) strengths.push(`Great reputation, ${item.rating}★ from ${item.reviewCount} reviews`);
  if (item.audit?.httpsActive) strengths.push("Secure (HTTPS) website");
  if (strengths.length) {
    y = ensure(doc, y, 24);
    y = heading(doc, "What's already working", y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    for (const s of strengths.slice(0, 6)) {
      y = ensure(doc, y, 7);
      doc.setTextColor(...GOOD); doc.setFont("helvetica", "bold"); doc.text("+", M, y);
      doc.setTextColor(60, 66, 63); doc.setFont("helvetica", "normal"); doc.text(s, M + 6, y); y += 6;
    }
    y += 4;
  }

  // ---- where you're losing customers / action plan ----
  if (opps.length) {
    y = ensure(doc, y, 30);
    y = heading(doc, "Where you're losing customers, and how to win them back", y);
    opps.slice(0, 8).forEach((o, i) => {
      const m = OPPORTUNITY_META[o];
      y = ensure(doc, y, 30);
      doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
      const t = doc.splitTextToSize(`${i + 1}.  ${m.long}`, W - 2 * M); doc.text(t, M, y); y += t.length * 5 + 1.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
      doc.text("WHY IT'S COSTING YOU", M + 5, y); y += 4;
      doc.setTextColor(60, 66, 63); doc.setFontSize(9);
      const why = doc.splitTextToSize(m.why, W - 2 * M - 5); doc.text(why, M + 5, y); y += why.length * 4.3 + 1.5;
      doc.setTextColor(...TEAL); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      doc.text("HOW WE'D FIX IT", M + 5, y); y += 4;
      doc.setTextColor(60, 66, 63); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      const fix = doc.splitTextToSize(m.fix, W - 2 * M - 5); doc.text(fix, M + 5, y); y += fix.length * 4.3 + 6;
    });
  }

  // ---- CTA ----
  y = ensure(doc, y, 42);
  doc.setFillColor(...TEAL); doc.roundedRect(M, y, W - 2 * M, 36, 2.5, 2.5, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Book your free 15-minute strategy call", M + 8, y + 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.text("Message us on WhatsApp and we'll walk through your 3 biggest wins. No obligation, no jargon.", M + 8, y + 18);
  doc.setFontSize(9.5); doc.setFont("helvetica", "bold");
  const cy = y + 28;
  doc.textWithLink(`WhatsApp  ${CUSTOMY.whatsapp}`, M + 8, cy, { url: CUSTOMY.whatsappUrl });
  doc.textWithLink(CUSTOMY.site, W - M - 8, cy, { url: CUSTOMY.siteUrl, align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(CUSTOMY.tagline, W - M - 8, cy + 5.5, { align: "right" });

  footer(doc);
  doc.save(fileName(item, "audit"));
}

// =============================================================================
// INTERNAL / ADMIN REPORT: everything (scores, dimensions, sales angles, data)
// =============================================================================
function buildAdminPdf(item: Lead) {
  const doc = new jsPDF();
  let y = M;
  doc.setFillColor(...INK); doc.rect(0, 0, W, 6, "F");
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("INTERNAL · Scanmap by Customy", M, y + 6);
  doc.text(new Date().toLocaleDateString(), W - M, y + 6, { align: "right" }); y += 14;

  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  const nameLines = doc.splitTextToSize(item.name, W - 2 * M - 40); doc.text(nameLines, M, y);
  const sc = scoreRGB(item.stats.score);
  doc.setTextColor(...sc); doc.setFontSize(26); doc.text(`${item.stats.score}`, W - M, y, { align: "right" });
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  doc.text(`${item.stats.riskLevel} · /100`, W - M, y + 5, { align: "right" });
  y += nameLines.length * 6 + 3;
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`${item.category ? item.category + " · " : ""}${item.address || "n/a"}`, M, y); y += 8;

  if (item.stats.dimensions) { y = heading(doc, "Presence dimensions", y); y = dimensionBars(doc, item.stats.dimensions, y); }

  // sales angles
  const opps = item.opportunities ?? [];
  if (opps.length) {
    y = ensure(doc, y, 20); y = heading(doc, "Sales angles", y);
    doc.setFontSize(9.5);
    for (const o of opps) {
      const m = OPPORTUNITY_META[o];
      y = ensure(doc, y, 7);
      doc.setTextColor(...TEAL); doc.setFont("helvetica", "bold"); doc.text("›", M, y);
      doc.text(m.sell, M + 5, y);
      doc.setTextColor(60, 66, 63); doc.setFont("helvetica", "normal");
      doc.text(doc.splitTextToSize(m.long, W - 2 * M - 50), M + 52, y); y += 6;
    }
    y += 2;
  }

  // contact
  y = ensure(doc, y, 30); y = heading(doc, "Contact", y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const fields: [string, string][] = [
    ["Website", item.url || "n/a"], ["Email", item.email || "n/a"], ["Phone", item.phone || "n/a"],
    ["WhatsApp", item.whatsapp || item.audit?.whatsapp || "n/a"], ["Stack", item.tech || "n/a"],
    ["Rating", item.rating ? `${item.rating} (${item.reviewCount || 0} reviews)` : "n/a"], ["Status", item.status ?? "NEW"],
  ];
  for (const [k, v] of fields) {
    y = ensure(doc, y, 7);
    doc.setTextColor(...MUTED); doc.text(k, M, y);
    doc.setTextColor(...INK); const lines = doc.splitTextToSize(v, W - 2 * M - 30); doc.text(lines, M + 30, y);
    y += Math.max(6, lines.length * 5);
  }
  y += 4;

  // website breakdown
  if (item.scoreFactors?.length) {
    y = ensure(doc, y, 20); y = heading(doc, "Website breakdown", y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    for (const f of item.scoreFactors) {
      y = ensure(doc, y, 6);
      doc.setTextColor(f.ok ? GOOD[0] : BAD[0], f.ok ? GOOD[1] : BAD[1], f.ok ? GOOD[2] : BAD[2]); doc.text(f.ok ? "+" : "-", M, y);
      doc.setTextColor(...INK); doc.text(f.label, M + 6, y);
      doc.setTextColor(...MUTED); doc.text(`${f.value ? f.value + "  " : ""}${f.awarded}/${f.weight}`, W - M, y, { align: "right" });
      y += 5;
    }
    y += 4;
  }

  // pitch + notes
  y = ensure(doc, y, 16); y = heading(doc, "Pitch", y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60, 66, 63);
  const pitch = doc.splitTextToSize(item.pitch || "", W - 2 * M); doc.text(pitch, M, y); y += pitch.length * 5 + 4;
  if (item.notes?.trim()) {
    y = ensure(doc, y, 16); y = heading(doc, "Notes", y);
    doc.setTextColor(60, 66, 63); doc.text(doc.splitTextToSize(item.notes, W - 2 * M), M, y);
  }

  footer(doc);
  doc.save(fileName(item, "internal"));
}

export function generatePdf(item: Lead, mode: "client" | "admin" = "admin", opts?: PdfOpts) {
  if (mode === "client") buildClientPdf(item, opts);
  else buildAdminPdf(item);
}
