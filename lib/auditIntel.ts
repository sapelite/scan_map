// lib/auditIntel.ts
// The "intelligence layer": turns a Lead's raw audit data into detailed, human
// findings (evidence -> what it means -> the fix), a prioritised action plan, and
// a suggested scope of work. Pure functions over an existing Lead, so they work
// on every lead in the library with no re-scan. Both reports are built on this.
import { Lead, PresenceKey } from "./types";
import { BALI_AREAS } from "./bali";
import { contactChannels, maxFollowers } from "./leadValue";

export type Severity = "critical" | "warn" | "opportunity" | "ok";
export type Impact = "High" | "Medium" | "Low";
export type Effort = "Quick" | "Medium" | "Project";
export type Service =
  | "Website build" | "Website rebuild" | "Migration / redesign" | "Security"
  | "SEO" | "Local SEO" | "Content" | "Social setup" | "Social management"
  | "Marketing setup" | "Booking integration" | "Lead capture" | "Reputation";

export interface Finding {
  dimension: PresenceKey;
  severity: Severity;
  title: string;          // short headline
  evidence: string;       // what we actually measured
  meaning: string;        // why it costs them
  fix: string;            // what we'd do
  impact: Impact;
  effort: Effort;
  service: Service;
}

const DIM_LABEL: Record<PresenceKey, string> = {
  site: "Website", social: "Social media", marketing: "Marketing", reputation: "Reputation", content: "Content",
};
export const dimensionLabel = (k: PresenceKey) => DIM_LABEL[k];

// ---------------------------------------------------------------------------
// small analyses, each usable on its own in the reports
// ---------------------------------------------------------------------------

const areaOf = (lead: Lead) => {
  const a = (lead.address || "").toLowerCase();
  return BALI_AREAS.find((x) => a.includes(x.toLowerCase())) || "";
};
const realEmail = (lead: Lead) => !!lead.email && !/^no email/i.test(lead.email);
const hasPhone = (lead: Lead) => !!lead.phone && lead.phone !== "No Phone";

/** Can a customer actually act? book / message / call / leave their details. */
export function conversionReadiness(lead: Lead) {
  const a = lead.audit;
  const canBook = !!a?.hasBooking;
  const canMessage = !!(lead.whatsapp || a?.whatsapp || a?.hasLiveChat);
  const canCall = hasPhone(lead) || (a?.phones?.length ?? 0) > 0;
  const canCapture = !!a?.hasEmailCapture;
  const items = [
    { label: "Book online", ok: canBook },
    { label: "Message / chat", ok: canMessage },
    { label: "Call", ok: canCall },
    { label: "Capture leads (email)", ok: canCapture },
  ];
  const score = items.filter((i) => i.ok).length;
  return { canBook, canMessage, canCall, canCapture, items, score, total: items.length };
}

/** Is the site (and listing) targeting the local search a tourist would type? */
export function localSeo(lead: Lead) {
  const a = lead.audit;
  const area = areaOf(lead);
  const cat = (lead.category || "").toLowerCase();
  const catWords = cat.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const hay = `${a?.title ?? ""} ${a?.metaDescription ?? ""}`.toLowerCase();
  const mentionsLocation = !!area && (hay.includes(area.toLowerCase()) || hay.includes("bali"));
  const mentionsCategory = catWords.length === 0 ? true : catWords.some((w) => hay.includes(w));
  const titlePresent = !!a?.title && a.titleLength >= 10;
  const titleLenOk = a ? a.titleLength >= 30 && a.titleLength <= 65 : false;
  const metaPresent = !!a?.metaDescription && a.metaDescriptionLength >= 50;
  return { area, mentionsLocation, mentionsCategory, titlePresent, titleLenOk, metaPresent };
}

/** What their social bios actually do for them: a link, a booking path, contact. */
export function socialBio(lead: Lead) {
  const bios = (lead.socialInsights ?? []).map((s) => s.bio || "").filter(Boolean);
  const text = bios.join("  ").toLowerCase();
  const socials = lead.socials ?? lead.audit?.socials;
  const platforms = socials ? Object.values(socials).filter(Boolean).length : 0;
  return {
    hasBio: bios.length > 0,
    hasLink: /\b(link in bio|linktr\.ee|beacons\.|link\.|https?:\/\/)/i.test(text),
    hasBooking: /\b(book|booking|reserve|reservation|wa\.me|whatsapp|order)/i.test(text),
    hasContact: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\+?\d[\d\s-]{7,}/i.test(text),
    platforms,
    crossPlatform: platforms >= 2,
    followers: maxFollowers(lead),
  };
}

// ---------------------------------------------------------------------------
// findings: the heart of the deep audit
// ---------------------------------------------------------------------------

const F = (
  dimension: PresenceKey, severity: Severity, title: string, evidence: string,
  meaning: string, fix: string, impact: Impact, effort: Effort, service: Service,
): Finding => ({ dimension, severity, title, evidence, meaning, fix, impact, effort, service });

export function auditFindings(lead: Lead): Finding[] {
  const out: Finding[] = [];
  const a = lead.audit;
  const ws = lead.websiteStatus;

  // ---------- WEBSITE ----------
  if (lead.isSocialUrl) {
    out.push(F("site", "critical", "No real website, only a social page",
      "Their Google listing links to a social profile, not a site they own.",
      "They can't take direct bookings, can't be found on Google search, and don't own their audience.",
      "Build a fast website that turns their social following into direct bookings.",
      "High", "Project", "Website build"));
  } else if (ws === "none") {
    out.push(F("site", "critical", "No website at all",
      "No website found on the Google listing or the open web.",
      "Anyone who looks them up has nowhere to go to learn more or book; invisible in Google search.",
      "Build a mobile-first website with their story, offering, photos and a way to book.",
      "High", "Project", "Website build"));
  } else if (ws === "unreachable") {
    out.push(F("site", "critical", "Website is down",
      `The site (${lead.websiteFromMaps || lead.url}) didn't load.`,
      "A dead link from Google is worse than none, people assume they've closed.",
      "Rebuild on reliable hosting so the link from Google always works.",
      "High", "Project", "Website rebuild"));
  } else if (a) {
    if (!a.httpsActive) out.push(F("site", "critical", "Not secure (no HTTPS)",
      "The site is served over http, no SSL.",
      "Browsers show a 'Not secure' warning that scares visitors off, and Google ranks it lower.",
      "Install SSL and serve the whole site over HTTPS.", "High", "Quick", "Security"));
    if (!a.mobileViewport) out.push(F("site", "critical", "Breaks on mobile",
      "No mobile viewport set.",
      "Most Bali tourists browse on a phone, a broken mobile layout loses them in seconds.",
      "Rebuild responsively so it works on every phone.", "High", "Medium", "Migration / redesign"));
    if (a.tech?.includes("Wix") || a.tech?.includes("Squarespace"))
      out.push(F("site", "warn", "Built on a template builder",
        `Detected ${a.tech.find((t) => t === "Wix" || t === "Squarespace")}.`,
        "Template builders are slower, harder to rank, and cap how far the brand and SEO can grow.",
        "Migrate to a fast, custom-built site they fully own.", "Medium", "Project", "Migration / redesign"));
    const slow = (typeof a.psiPerformance === "number" && a.psiPerformance < 50) || (a.loadTimeMs > 5000);
    if (slow) out.push(F("site", "warn", "Slow to load",
      typeof a.psiPerformance === "number" ? `Google performance ${a.psiPerformance}/100, LCP ${((a.psiLcpMs ?? 0) / 1000).toFixed(1)}s.` : `Homepage took ${(a.loadTimeMs / 1000).toFixed(1)}s.`,
      "More than half of visitors leave if a page takes over 3s, and slow sites rank worse.",
      "Optimise images, hosting and code to load under 2s.", "High", "Medium", "Migration / redesign"));
  }

  // ---------- SEO / CONTENT (only meaningful with a working site) ----------
  if (a && ws === "audited") {
    const ls = localSeo(lead);
    if (!ls.titlePresent) out.push(F("content", "warn", "Weak or missing page title",
      a.title ? `Title: "${a.title}" (${a.titleLength} chars).` : "No <title> tag.",
      "The title is what shows in Google results, a weak one costs clicks and rankings.",
      "Write a clear title with the business, category and location.", "Medium", "Quick", "SEO"));
    if (!ls.metaPresent) out.push(F("content", "warn", "No meta description",
      "The page has no usable meta description.",
      "Google shows a random snippet instead of a pitch, fewer people click through.",
      "Write a compelling meta description for every key page.", "Medium", "Quick", "SEO"));
    if (!ls.mentionsLocation || !ls.mentionsCategory)
      out.push(F("content", "opportunity", "Not targeting local search",
        `Title/description ${!ls.mentionsLocation ? "doesn't mention the area" : "mentions the area"}${!ls.mentionsCategory ? " or what they do" : ""}.`,
        "Tourists search '[thing] in [area]', without those words on the page they won't be found.",
        "Optimise titles, headings and copy for local keywords (e.g. 'cafe in Canggu').", "High", "Medium", "Local SEO"));
    if (a.wordCount < 300) out.push(F("content", "warn", "Thin content",
      `Only ${a.wordCount} words on the homepage.`,
      "Thin pages don't build trust and give Google nothing to rank.",
      "Write pages that sell the experience and answer customer questions.", "Medium", "Medium", "Content"));
    if (!a.jsonLd) out.push(F("content", "opportunity", "No structured data",
      "No schema.org / JSON-LD markup found.",
      "Structured data unlocks rich Google results (ratings, hours, prices) that win the click.",
      "Add LocalBusiness schema with hours, location and ratings.", "Low", "Quick", "SEO"));
    if (!a.hasBlog && a.wordCount < 400) out.push(F("content", "opportunity", "No fresh content",
      "No blog or news section detected.",
      "Fresh content ranks for long-tail searches and keeps the brand top of mind.",
      "Publish guides and posts tied to what customers search for.", "Low", "Project", "Content"));
  }

  // ---------- MARKETING / CONVERSION ----------
  if (a && ws === "audited") {
    const conv = conversionReadiness(lead);
    if (!conv.canBook) out.push(F("marketing", "warn", "No online booking",
      "No booking, ordering or reservation flow on the site.",
      "Every booking handled by DM or phone tag is friction that loses customers to competitors.",
      "Add online booking so customers can commit in one tap, any time.", "High", "Medium", "Booking integration"));
    if (!a.hasGoogleAnalytics && !a.hasGoogleTagManager) out.push(F("marketing", "warn", "Flying blind (no analytics)",
      "No Google Analytics or Tag Manager found.",
      "Without analytics every marketing decision is a guess, they can't see what works.",
      "Install analytics and conversion tracking.", "Medium", "Quick", "Marketing setup"));
    if ((a.adPixels?.length ?? 0) === 0) out.push(F("marketing", "opportunity", "No ad pixels",
      "No Meta / Google / TikTok ad pixel installed.",
      "They can't retarget visitors or run measurable ads, growth stays unpredictable.",
      "Install ad pixels and set up retargeting.", "Medium", "Quick", "Marketing setup"));
    if (!a.hasEmailCapture) out.push(F("marketing", "opportunity", "No lead capture",
      "No newsletter or email-capture form.",
      "Visitors leave with no way to bring them back, traffic they paid for in effort is lost.",
      "Add a lead-capture offer and an email flow.", "Medium", "Medium", "Lead capture"));
    if ((a.emails?.length ?? 0) === 0 && (a.phones?.length ?? 0) === 0 && !a.whatsapp)
      out.push(F("marketing", "warn", "Hard to contact from the site",
        "No email, phone or WhatsApp on the website.",
        "If people can't reach them quickly they move to the next option, the sale is lost at the line.",
        "Add clear contact options (WhatsApp, phone, form) on every page.", "Medium", "Quick", "Lead capture"));
  }

  // ---------- SOCIAL ----------
  const socials = lead.socials ?? a?.socials;
  const socialCount = socials ? Object.values(socials).filter(Boolean).length : 0;
  const followers = maxFollowers(lead);
  const lowPosts = (lead.socialInsights ?? []).some((s) => s.posts !== undefined && s.posts < 12);
  if (socialCount === 0) {
    out.push(F("social", "warn", "No social presence",
      "No social profiles found on the site, listing or the web.",
      "In Bali social proof is the storefront, no socials means no discovery and no trust.",
      "Set up and brand Instagram + Facebook and run a content calendar.", "High", "Project", "Social setup"));
  } else {
    if (!socials?.instagram) out.push(F("social", "warn", "Not on Instagram",
      "No Instagram profile found.",
      "Instagram is the number one way tourists discover places in Bali.",
      "Launch a branded Instagram with reels, stories and a posting schedule.", "High", "Medium", "Social setup"));
    if (lowPosts || socialCount === 1) out.push(F("social", "opportunity", "Inactive / thin socials",
      lowPosts ? "Their profile has very few posts." : "Only one platform, and little activity.",
      "A near-empty presence tells customers (and the algorithm) they're inactive.",
      "Take over content creation and posting across the platforms that matter.", "Medium", "Project", "Social management"));
    if (followers > 0 && followers < 1000) out.push(F("social", "opportunity", "Small audience",
      `Largest following is ${followers.toLocaleString()}.`,
      "A small audience limits reach and word of mouth, the biggest free growth channel in Bali.",
      "Grow the following with consistent content and collabs.", "Medium", "Project", "Social management"));
    const bio = socialBio(lead);
    if (bio.hasBio && !bio.hasLink && !bio.hasBooking && (ws === "none" || lead.isSocialUrl))
      out.push(F("social", "opportunity", "Social bio doesn't convert",
        "Their bio has no link or booking path.",
        "They get the attention but nowhere to send it, so followers don't become bookings.",
        "Add a link/booking destination and route the audience to it.", "Medium", "Quick", "Social management"));
  }

  // ---------- REPUTATION ----------
  if (lead.rating > 0 && lead.rating < 4.0)
    out.push(F("reputation", "warn", "Below-average rating",
      `${lead.rating.toFixed(1)}★ from ${lead.reviewCount || 0} reviews.`,
      "A low rating is the biggest deterrent at the moment someone decides, it caps every other effort.",
      "Fix recurring complaints, respond to reviews, run a reputation programme.", "High", "Project", "Reputation"));
  else if (lead.reviewCount > 0 && lead.reviewCount < 10)
    out.push(F("reputation", "opportunity", "Very few reviews",
      `Only ${lead.reviewCount} Google reviews.`,
      "Tourists pick the place with more and better reviews, a thin count quietly costs bookings.",
      "Run a review campaign that asks happy customers to post.", "Medium", "Quick", "Reputation"));

  return out;
}

/** What's already working — the positives, so a report isn't all bad news. */
export function strengths(lead: Lead): string[] {
  const out: string[] = [];
  const a = lead.audit;
  const dims = lead.stats?.dimensions;
  if (lead.rating >= 4.5 && lead.reviewCount >= 50) out.push(`Excellent reputation: ${lead.rating.toFixed(1)}★ from ${lead.reviewCount} reviews`);
  else if (lead.rating >= 4.3 && lead.reviewCount >= 20) out.push(`Strong reputation: ${lead.rating.toFixed(1)}★ from ${lead.reviewCount} reviews`);
  const f = maxFollowers(lead);
  if (f >= 10000) out.push(`A real audience already built: ${f.toLocaleString()} followers`);
  if (a?.httpsActive) out.push("Secure (HTTPS) website");
  if (a?.hasBooking) out.push("Already takes online bookings");
  if (typeof a?.psiPerformance === "number" && a.psiPerformance >= 80) out.push("Fast website (good PageSpeed)");
  if (dims) for (const k of Object.keys(dims) as PresenceKey[]) if ((dims[k] ?? 0) >= 75) out.push(`Strong ${DIM_LABEL[k].toLowerCase()}`);
  return [...new Set(out)].slice(0, 6);
}

// ---------------------------------------------------------------------------
// prioritisation + scope
// ---------------------------------------------------------------------------

const SEV_W: Record<Severity, number> = { critical: 4, warn: 3, opportunity: 2, ok: 0 };
const IMP_W: Record<Impact, number> = { High: 3, Medium: 2, Low: 1 };
const EFF_W: Record<Effort, number> = { Quick: 0, Medium: 1, Project: 2 };

export function priorityScore(f: Finding): number {
  return SEV_W[f.severity] * 10 + IMP_W[f.impact] * 3 - EFF_W[f.effort];
}

/** The findings worth acting on, ordered by what to do first. */
export function actionPlan(lead: Lead): Finding[] {
  return auditFindings(lead)
    .filter((f) => f.severity !== "ok")
    .sort((x, y) => priorityScore(y) - priorityScore(x));
}

export interface Scope {
  services: Service[];        // distinct service lines this lead needs, most-needed first
  headline: string;          // a one-line package suggestion
  criticalCount: number;
}

/** The distinct work this lead needs, rolled into a suggested package. */
export function suggestedScope(lead: Lead): Scope {
  const plan = actionPlan(lead);
  const order: Service[] = [];
  for (const f of plan) if (!order.includes(f.service)) order.push(f.service);
  const has = (s: Service) => order.includes(s);
  const buildNeeded = has("Website build") || has("Website rebuild");
  const socialNeeded = has("Social setup") || has("Social management");
  const mktNeeded = has("Marketing setup") || has("Booking integration") || has("Lead capture");

  let headline: string;
  if (buildNeeded && socialNeeded && mktNeeded) headline = "Full digital presence (site + social + marketing)";
  else if (buildNeeded && socialNeeded) headline = "Website + social presence";
  else if (buildNeeded) headline = "Website build / rebuild";
  else if (socialNeeded && mktNeeded) headline = "Social + marketing growth";
  else if (mktNeeded) headline = "Conversion + marketing tune-up";
  else if (order.length) headline = `${order[0]} focus`;
  else headline = "Already strong, optimisation / retainer";

  return { services: order, headline, criticalCount: plan.filter((f) => f.severity === "critical").length };
}
