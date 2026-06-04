import jsPDF from "jspdf";
import { Lead, PresenceKey } from "@/lib/types";
import { BRAND as CUSTOMY } from "@/lib/brand";
import { actionPlan, suggestedScope, conversionReadiness, strengths, dimensionLabel, type Finding } from "@/lib/auditIntel";
import { PeerBenchmark } from "@/lib/benchmark";
import { leadValue, valueBand, maxFollowers, contactChannels } from "@/lib/leadValue";

// ---- palette (RGB), aligned to the Customy brand: off-white, ink, green accent ----
const GREEN: [number, number, number] = [52, 199, 89];
const GREEN_DEEP: [number, number, number] = [36, 138, 61];
const INK: [number, number, number] = [29, 29, 31];
const INK_SOFT: [number, number, number] = [86, 86, 89];
const MUTED: [number, number, number] = [142, 142, 147];
const LINE: [number, number, number] = [228, 229, 230];
const CARD: [number, number, number] = [245, 245, 247];
const WHITE: [number, number, number] = [255, 255, 255];
const WHITE_DIM: [number, number, number] = [176, 176, 182];
const GOOD: [number, number, number] = [36, 138, 61];
const MID: [number, number, number] = [194, 113, 12];
const BAD: [number, number, number] = [220, 38, 38];
const TRACK: [number, number, number] = [236, 239, 237];

const W = 210, H = 297, M = 18;
const colW = W - 2 * M;
const scoreRGB = (s: number): [number, number, number] => (s >= 70 ? GOOD : s >= 40 ? MID : BAD);
const sevRGB = (s: Finding["severity"]): [number, number, number] => (s === "critical" ? BAD : s === "warn" ? MID : GREEN_DEEP);

export interface PdfOpts { benchmark?: PeerBenchmark }

const DIM_KEYS: PresenceKey[] = ["site", "social", "marketing", "reputation", "content"];

const fileName = (item: Lead, kind: string) =>
  `${kind}_${item.name.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40)}.pdf`;

const humanNum = (n: number): string =>
  n >= 1_000_000 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  : n >= 10_000 ? Math.round(n / 1000) + "K"
  : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K"
  : String(n);

// ---------------------------------------------------------------------------
// shared layout helpers
// ---------------------------------------------------------------------------

function sectionLabel(doc: jsPDF, text: string, y: number) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...GREEN_DEEP);
  doc.setCharSpace(0.7); doc.text(text.toUpperCase(), M, y); doc.setCharSpace(0);
  y += 2.6;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(M, y, W - M, y);
  return y + 7;
}

function ensure(doc: jsPDF, y: number, need = 16) {
  if (y + need > H - 18) { doc.addPage(); return M + 6; }
  return y;
}

function footer(doc: jsPDF, tag?: string) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(M, H - 13, W - M, H - 13);
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(tag || `${CUSTOMY.name}  ·  ${CUSTOMY.tagline}`, M, H - 8);
    doc.text(`${i} / ${pages}`, W - M, H - 8, { align: "right" });
  }
}

function paragraph(doc: jsPDF, text: string, x: number, y: number, width: number, lineH = 4.7, size = 9.5, color: [number, number, number] = INK_SOFT) {
  doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(...color);
  const lines = doc.splitTextToSize(text, width);
  doc.text(lines, x, y, { lineHeightFactor: 1.35 });
  return y + lines.length * lineH;
}

/** Dimension bars, optionally with a peer-median marker. */
function dimensionBars(doc: jsPDF, dims: Partial<Record<PresenceKey, number>>, y: number, peer?: Partial<Record<PresenceKey, number>>) {
  const barX = M + 36, barW = W - M - barX - 14;
  for (const k of DIM_KEYS) {
    const v = dims[k] ?? 0;
    doc.setTextColor(...INK_SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(dimensionLabel(k), M, y + 3.2);
    doc.setFillColor(...TRACK); doc.roundedRect(barX, y, barW, 4, 2, 2, "F");
    doc.setFillColor(...scoreRGB(v)); doc.roundedRect(barX, y, Math.max((barW * v) / 100, 2), 4, 2, 2, "F");
    // peer median marker
    const pm = peer?.[k];
    if (typeof pm === "number") {
      const mx = barX + (barW * pm) / 100;
      doc.setDrawColor(...INK); doc.setLineWidth(0.7); doc.line(mx, y - 1, mx, y + 5);
    }
    doc.setTextColor(...scoreRGB(v)); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
    doc.text(`${v}`, W - M, y + 3.2, { align: "right" });
    y += 9;
  }
  if (peer) {
    doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.text("| vertical mark = typical peer", barX, y + 1);
    y += 4;
  }
  return y + 2;
}

function scoreScale(doc: jsPDF, score: number, x: number, w: number, y: number) {
  const h = 3.4;
  doc.setFillColor(...BAD); doc.roundedRect(x, y, w * 0.4, h, 1.7, 1.7, "F");
  doc.setFillColor(...MID); doc.rect(x + w * 0.4, y, w * 0.3, h, "F");
  doc.setFillColor(...GOOD); doc.roundedRect(x + w * 0.7, y, w * 0.3, h, 1.7, 1.7, "F");
  const mx = x + (w * Math.min(Math.max(score, 0), 100)) / 100;
  doc.setFillColor(...INK); doc.triangle(mx, y - 0.6, mx - 2.2, y - 4.6, mx + 2.2, y - 4.6, "F");
  return y + h;
}

/** You vs typical vs top, from the peer benchmark. */
function benchmarkBlock(doc: jsPDF, bm: PeerBenchmark, y: number) {
  const labelW = 46, barX = M + labelW, barW = W - M - barX - 14;
  const row = (label: string, val: number, color: [number, number, number], yy: number) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK_SOFT);
    doc.text(doc.splitTextToSize(label, labelW - 3), M, yy + 3.4);
    doc.setFillColor(...TRACK); doc.roundedRect(barX, yy, barW, 5, 2.5, 2.5, "F");
    doc.setFillColor(...color); doc.roundedRect(barX, yy, Math.max((barW * val) / 100, 3), 5, 2.5, 2.5, "F");
    doc.setTextColor(...color); doc.setFont("helvetica", "bold"); doc.text(`${val}`, W - M, yy + 3.7, { align: "right" });
    return yy + 10;
  };
  y = row("You", bm.yourScore, scoreRGB(bm.yourScore), y);
  y = row(`Typical ${bm.label}`, bm.medianScore, MUTED, y);
  y = row("Top performers", bm.topScore, GOOD, y) + 1;
  const gap = Math.max(bm.medianScore - bm.yourScore, 0);
  const msg = gap >= 6
    ? `You're ${gap} points behind the typical ${bm.label} and ${Math.max(bm.topScore - bm.yourScore, 0)} behind the best. ${bm.basis}`
    : `You're keeping pace with the typical ${bm.label}. ${bm.basis}`;
  return paragraph(doc, msg, M, y, colW, 4.4, 9, MUTED) + 4;
}

/** The four "can a customer act?" checks as coloured dots. */
function conversionRow(doc: jsPDF, lead: Lead, y: number) {
  const conv = conversionReadiness(lead);
  const colXs = [M, M + colW / 2];
  conv.items.forEach((it, i) => {
    const x = colXs[i % 2], yy = y + Math.floor(i / 2) * 6.5;
    doc.setFillColor(...(it.ok ? GOOD : BAD)); doc.circle(x + 1.4, yy - 1.3, 1.4, "F");
    doc.setTextColor(...INK_SOFT); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(it.label, x + 5, yy);
  });
  return y + Math.ceil(conv.items.length / 2) * 6.5 + 2;
}

/** One finding: numbered, title, optional meta, then evidence / why / fix. */
function findingBlock(doc: jsPDF, f: Finding, i: number, y: number, mode: "client" | "internal") {
  const tx = M + 10;
  y = ensure(doc, y, 30);
  doc.setFillColor(...sevRGB(f.severity)); doc.circle(M + 3, y, 3.1, "F");
  doc.setTextColor(...WHITE); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text(`${i + 1}`, M + 3, y + 1.5, { align: "center" });

  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  const t = doc.splitTextToSize(f.title, W - M - tx);
  doc.text(t, tx, y + 1.5, { lineHeightFactor: 1.2 });
  y += Math.max(5, t.length * 5) + 2;

  // meta line
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setCharSpace(0.3);
  doc.setTextColor(...sevRGB(f.severity));
  const meta = mode === "internal"
    ? `${f.severity.toUpperCase()}  ·  ${f.impact.toUpperCase()} IMPACT  ·  ${f.effort.toUpperCase()}  ·  ${f.service.toUpperCase()}`
    : (f.severity === "critical" ? "CRITICAL" : f.impact === "High" ? "HIGH PRIORITY" : f.impact === "Medium" ? "WORTH DOING" : "QUICK WIN");
  doc.text(meta, tx, y); doc.setCharSpace(0); y += 4.5;

  if (mode === "internal") {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.setCharSpace(0.3);
    doc.text("FOUND", tx, y); doc.setCharSpace(0); y += 3.8;
    y = paragraph(doc, f.evidence, tx, y, W - M - tx, 4.4, 9, INK_SOFT) + 1.5;
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.setCharSpace(0.3);
  doc.text(mode === "client" ? "WHY IT MATTERS" : "WHY IT COSTS THEM", tx, y); doc.setCharSpace(0); y += 3.8;
  y = paragraph(doc, f.meaning, tx, y, W - M - tx, 4.4, 9.5, INK_SOFT) + 1.5;

  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...GREEN_DEEP); doc.setCharSpace(0.3);
  doc.text(mode === "client" ? "WHAT WE'D DO" : "FIX", tx, y); doc.setCharSpace(0); y += 3.8;
  y = paragraph(doc, f.fix, tx, y, W - M - tx, 4.4, 9.5, INK_SOFT) + 6;
  return y;
}

function verdict(score: number) {
  if (score < 40) return "Right now you're losing customers to better-presented competitors, but it's very fixable.";
  if (score < 60) return "You've got a foundation, but real bookings are slipping through the gaps below.";
  if (score < 80) return "You're doing well. A few targeted moves will turn browsers into bookings.";
  return "You're ahead of most. Let's sharpen the edges and protect your lead.";
}
function interpretation(score: number) {
  if (score < 35) return "Lots of room to grow, which means lots of upside from a focused push.";
  if (score < 60) return "A solid base with several clear, high-impact opportunities.";
  if (score < 80) return "Good presence overall. A few targeted fixes will lift results.";
  return "Excellent presence. Mostly fine-tuning from here.";
}

// =============================================================================
// CLIENT REPORT
// =============================================================================
function renderClientPdf(item: Lead, opts?: PdfOpts): jsPDF {
  const doc = new jsPDF();
  const score = item.stats.score;
  const plan = actionPlan(item);

  // ---- cover band ----
  doc.setFont("helvetica", "bold"); doc.setFontSize(20);
  let nameSize = 20;
  while (nameSize > 13 && doc.getTextWidth(item.name) > colW) { nameSize -= 1; doc.setFontSize(nameSize); }
  const nameLines = doc.splitTextToSize(item.name, colW).slice(0, 2);
  const bandH = nameLines.length > 1 ? 42 : 34;
  doc.setFillColor(...INK); doc.rect(0, 0, W, bandH, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...GREEN); doc.setCharSpace(1.2);
  doc.text("DIGITAL PRESENCE AUDIT", M, 13); doc.setCharSpace(0);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...WHITE_DIM);
  doc.text(new Date().toLocaleDateString(undefined, { dateStyle: "medium" }), W - M, 13, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(nameSize); doc.setTextColor(...WHITE);
  doc.text(nameLines, M, 23, { lineHeightFactor: 1.1 });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...WHITE_DIM);
  doc.text(`${item.category ? item.category + "   ·   " : ""}Prepared by Customy`, M, bandH - 5);

  let y = bandH + 13;

  // ---- verdict ----
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(13.5);
  const vLines = doc.splitTextToSize(verdict(score), colW);
  doc.text(vLines, M, y, { lineHeightFactor: 1.25 }); y += vLines.length * 6.4 + 7;

  // ---- score card ----
  const cardH = 32;
  doc.setFillColor(...CARD); doc.roundedRect(M, y, colW, cardH, 3, 3, "F");
  doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.roundedRect(M, y, colW, cardH, 3, 3, "S");
  doc.setTextColor(...scoreRGB(score)); doc.setFont("helvetica", "bold"); doc.setFontSize(34);
  doc.text(`${score}`, M + 10, y + 21);
  const numW = doc.getTextWidth(`${score}`);
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("/100", M + 13 + numW, y + 21);
  const tx = M + 52;
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("Your Digital Presence Score", tx, y + 11);
  paragraph(doc, interpretation(score), tx, y + 17, W - M - tx - 6, 4.4, 9.5, INK_SOFT);
  y += cardH + 9;
  y = scoreScale(doc, score, M, colW, y) + 9;

  // ---- benchmark ----
  if (opts?.benchmark) {
    y = ensure(doc, y, 46);
    y = sectionLabel(doc, `How you compare to ${opts.benchmark.label}`, y);
    y = benchmarkBlock(doc, opts.benchmark, y) + 4;
  }

  // ---- dimensions ----
  if (item.stats.dimensions) {
    y = ensure(doc, y, 64);
    y = sectionLabel(doc, "Where you stand", y);
    y = dimensionBars(doc, item.stats.dimensions, y, opts?.benchmark?.dimMedian) + 4;
  }

  // ---- can a customer act? ----
  y = ensure(doc, y, 30);
  y = sectionLabel(doc, "Can a customer act right now?", y);
  y = conversionRow(doc, item, y) + 4;

  // ---- strengths ----
  const wins = strengths(item);
  if (wins.length) {
    y = ensure(doc, y, 24);
    y = sectionLabel(doc, "What's already working", y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    for (const s of wins) {
      y = ensure(doc, y, 7);
      doc.setFillColor(...GOOD); doc.circle(M + 1.6, y - 1.3, 1, "F");
      doc.setTextColor(...INK_SOFT); doc.text(s, M + 6, y); y += 6.4;
    }
    y += 5;
  }

  // ---- priorities (action plan) ----
  if (plan.length) {
    y = ensure(doc, y, 34);
    y = sectionLabel(doc, "Your priorities, and how we'd fix them", y);
    plan.slice(0, 8).forEach((f, i) => { y = findingBlock(doc, f, i, y, "client"); });
  }

  // ---- CTA ----
  y = ensure(doc, y, 44);
  const ctaH = 38;
  doc.setFillColor(...INK); doc.roundedRect(M, y, colW, ctaH, 4, 4, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GREEN); doc.setCharSpace(1);
  doc.text("LET'S TALK", M + 9, y + 9); doc.setCharSpace(0);
  doc.setTextColor(...WHITE); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("Book your free 15-minute strategy call", M + 9, y + 17);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...WHITE_DIM);
  doc.text("Message us on WhatsApp and we'll walk through your biggest wins. No obligation.", M + 9, y + 24);
  const cy = y + 33;
  doc.setTextColor(...GREEN); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  doc.textWithLink(`WhatsApp  ${CUSTOMY.whatsapp}`, M + 9, cy, { url: CUSTOMY.whatsappUrl });
  doc.setTextColor(...WHITE_DIM);
  doc.textWithLink(CUSTOMY.site, W - M - 9, cy, { url: CUSTOMY.siteUrl, align: "right" });

  footer(doc);
  return doc;
}

// =============================================================================
// INTERNAL REPORT: a full scoping dossier
// =============================================================================
function bestChannel(item: Lead): string {
  if (item.whatsapp || item.audit?.whatsapp) return "WhatsApp";
  if (item.phone && item.phone !== "No Phone") return "Phone";
  if (item.email && !/^no email/i.test(item.email)) return "Email";
  const ig = item.socials?.instagram || item.audit?.socials?.instagram;
  if (ig) return "Instagram DM";
  return "No direct channel";
}

function renderAdminPdf(item: Lead, opts?: PdfOpts): jsPDF {
  const doc = new jsPDF();
  const score = item.stats.score;
  const scope = suggestedScope(item);
  const plan = actionPlan(item);
  const value = leadValue(item);
  const followers = maxFollowers(item);

  // ---- ink band ----
  doc.setFillColor(...INK); doc.rect(0, 0, W, 28, "F");
  doc.setTextColor(...GREEN); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setCharSpace(1);
  doc.text("INTERNAL  ·  SCANMAP BY CUSTOMY", M, 10); doc.setCharSpace(0);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...WHITE_DIM);
  doc.text(new Date().toLocaleDateString(), W - M, 10, { align: "right" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...WHITE);
  doc.text(doc.splitTextToSize(item.name, colW - 28)[0], M, 20);
  doc.setTextColor(...(score >= 70 ? [128, 230, 200] : score >= 40 ? [240, 200, 120] : [250, 170, 170]) as [number, number, number]);
  doc.setFontSize(16); doc.text(`${score}/100`, W - M, 20, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...WHITE_DIM);
  doc.text(`${item.category ? item.category + "  ·  " : ""}${item.address || "n/a"}`, M, 25.5);

  let y = 28 + 11;

  // ---- the one-glance summary box ----
  const boxH = 30;
  doc.setFillColor(...CARD); doc.roundedRect(M, y, colW, boxH, 3, 3, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GREEN_DEEP); doc.setCharSpace(0.5);
  doc.text("WHAT TO SELL", M + 7, y + 8); doc.setCharSpace(0);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(12.5);
  doc.text(doc.splitTextToSize(scope.headline, colW - 14)[0], M + 7, y + 15);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK_SOFT);
  const summary = `Lead value ${value}/100 (${valueBand(value)})   ·   ${scope.criticalCount} critical issue${scope.criticalCount === 1 ? "" : "s"}   ·   best channel: ${bestChannel(item)}`;
  doc.text(summary, M + 7, y + 23);
  doc.setTextColor(...MUTED); doc.setFontSize(8.5);
  doc.text(`Risk: ${item.stats.riskLevel}   ·   Status: ${item.status ?? "NEW"}`, M + 7, y + 27.5);
  y += boxH + 9;

  // ---- dimensions ----
  if (item.stats.dimensions) {
    y = ensure(doc, y, 60);
    y = sectionLabel(doc, "Presence dimensions", y);
    y = dimensionBars(doc, item.stats.dimensions, y, opts?.benchmark?.dimMedian) + 3;
  }

  // ---- conversion readiness ----
  y = ensure(doc, y, 28);
  y = sectionLabel(doc, "Conversion readiness", y);
  y = conversionRow(doc, item, y) + 3;

  // ---- action plan ----
  if (plan.length) {
    y = ensure(doc, y, 30);
    y = sectionLabel(doc, `Action plan (${plan.length}, in priority order)`, y);
    plan.forEach((f, i) => { y = findingBlock(doc, f, i, y, "internal"); });
  } else {
    y = ensure(doc, y, 16);
    y = sectionLabel(doc, "Action plan", y);
    y = paragraph(doc, "No critical gaps. Approach as a premium optimisation or retainer client.", M, y, colW, 5, 10, INK_SOFT) + 4;
  }

  // ---- social accounts ----
  const insights = item.socialInsights ?? [];
  if (insights.length) {
    y = ensure(doc, y, 20);
    y = sectionLabel(doc, "Social accounts", y);
    doc.setFontSize(9.5);
    for (const s of insights) {
      y = ensure(doc, y, 6);
      doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.text(`${s.platform}${s.verified ? " (verified)" : ""}`, M, y);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...INK_SOFT);
      doc.text(s.handle || "", M + 34, y);
      const stat = s.followers !== undefined ? `${humanNum(s.followers)} followers${s.posts !== undefined ? `, ${humanNum(s.posts)} posts` : ""}` : (s.note || "");
      doc.setTextColor(...MUTED); doc.text(stat, W - M, y, { align: "right" });
      y += 5.5;
    }
    y += 3;
  }

  // ---- technical signals ----
  const a = item.audit;
  if (a) {
    y = ensure(doc, y, 26);
    y = sectionLabel(doc, "Technical signals", y);
    const yn = (b: boolean) => (b ? "Yes" : "No");
    const rows: [string, string][] = [
      ["HTTPS", yn(a.httpsActive)],
      ["Mobile-ready", yn(a.mobileViewport)],
      ["Load (homepage)", a.loadTimeMs > 0 ? `${(a.loadTimeMs / 1000).toFixed(1)}s` : "n/a"],
      ["PageSpeed (Google)", typeof a.psiPerformance === "number" ? `${a.psiPerformance}/100` : "not run"],
      ["Analytics", yn(a.hasGoogleAnalytics || a.hasGoogleTagManager)],
      ["Ad pixels", a.adPixels?.length ? a.adPixels.join(", ") : "None"],
      ["Online booking", yn(a.hasBooking)],
      ["Lead capture", yn(a.hasEmailCapture)],
      ["Live chat", yn(a.hasLiveChat)],
      ["Blog / content", yn(a.hasBlog)],
      ["Schema markup", yn(a.jsonLd)],
      ["Words on homepage", `${a.wordCount}`],
      ["Tech stack", a.tech?.length ? a.tech.join(", ") : (item.tech || "n/a")],
    ];
    if (typeof a.pagesCrawled === "number" && a.pagesCrawled > 1 && item.deepReport) {
      rows.push(["Pages crawled", `${item.deepReport.pagesCrawled}/${item.deepReport.pagesDiscovered}`]);
      rows.push(["Broken links", `${item.deepReport.brokenLinks.length}`]);
      rows.push(["Homepage weight", `${item.deepReport.pageWeightKb} KB`]);
      rows.push(["Fresh content", item.deepReport.latestContentDate || (item.deepReport.hasFreshContent ? "yes" : "none found")]);
    }
    const colX = M + colW / 2;
    doc.setFontSize(9);
    rows.forEach((r, i) => {
      const x = i % 2 === 0 ? M : colX;
      if (i % 2 === 0) y = ensure(doc, y, 6);
      const yy = y;
      doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal"); doc.text(r[0], x, yy);
      doc.setTextColor(...INK); doc.text(doc.splitTextToSize(r[1], colW / 2 - 34)[0], x + 34, yy);
      if (i % 2 === 1 || i === rows.length - 1) y += 5.5;
    });
    y += 3;
  }

  // ---- contact ----
  y = ensure(doc, y, 28);
  y = sectionLabel(doc, "Contact", y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const fields: [string, string][] = [
    ["Website", item.url || "n/a"], ["Email", item.email || "n/a"], ["Phone", item.phone || "n/a"],
    ["WhatsApp", item.whatsapp || item.audit?.whatsapp || "n/a"],
    ["Rating", item.rating ? `${item.rating} (${item.reviewCount || 0} reviews)` : "n/a"],
    ["Followers", followers ? humanNum(followers) : "n/a"], ["Best channel", bestChannel(item)],
  ];
  for (const [k, v] of fields) {
    y = ensure(doc, y, 7);
    doc.setTextColor(...MUTED); doc.text(k, M, y);
    doc.setTextColor(...INK); const lines = doc.splitTextToSize(v, colW - 34); doc.text(lines, M + 34, y);
    y += Math.max(6, lines.length * 5);
  }
  y += 3;

  if (item.notes?.trim()) {
    y = ensure(doc, y, 16); y = sectionLabel(doc, "Notes", y);
    paragraph(doc, item.notes, M, y, colW, 5, 10, INK_SOFT);
  }

  footer(doc, `${CUSTOMY.name} internal  ·  ${item.name}`);
  return doc;
}

export function generatePdf(item: Lead, mode: "client" | "admin" = "admin", opts?: PdfOpts) {
  const doc = mode === "client" ? renderClientPdf(item, opts) : renderAdminPdf(item, opts);
  doc.save(fileName(item, mode === "client" ? "audit" : "internal"));
}

// exported for offline rendering/tests (returns the doc instead of saving)
export const __renderClientPdf = renderClientPdf;
export const __renderAdminPdf = renderAdminPdf;
