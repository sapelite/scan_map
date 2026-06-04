// lib/outreach.ts
// Ready-to-send first-contact messages, tailored to each lead.
import { Lead, Opportunity } from "./types";
import { BRAND } from "./brand";
import { BALI_AREAS } from "./bali";

const me = `${BRAND.sender} from ${BRAND.name}`;
// Broader Customy positioning: not just websites.
const whatWeDo = "We build websites, run marketing, and make custom tools for any kind of business.";

/** Possessive that handles names already ending in "s" (e.g. "Wave Riders'"). */
const possessive = (name: string) => name + (/s$/i.test(name) ? "'" : "'s");

/** Normalise a lead's number for a wa.me link (digits only, local 0 -> 62). */
export function waRecipient(lead: Lead): string | null {
  const raw = (lead.whatsapp || lead.phone || "").replace(/[^\d]/g, "");
  if (raw.length < 8) return null;
  return raw.startsWith("0") ? "62" + raw.slice(1) : raw;
}

// ----------------------------------------------------------------------------
// personalisation helpers
// ----------------------------------------------------------------------------

/** First known Bali area found in the address, phrased as " in Canggu" (or ""). */
function inArea(lead: Lead): string {
  const addr = (lead.address || "").toLowerCase();
  const hit = BALI_AREAS.find((a) => addr.includes(a.toLowerCase()));
  return hit ? ` in ${hit}` : "";
}

/** A short, genuine compliment from the rating, only when it's strong enough to mean something. */
function proof(lead: Lead): string {
  const r = lead.rating, n = lead.reviewCount;
  if (r >= 4.5 && n >= 30) return `Your ${r.toFixed(1)}★ from ${n} reviews is genuinely impressive, people clearly love the place. `;
  if (r >= 4.2 && n >= 10) return `Your reviews look great (${r.toFixed(1)}★ from ${n}), so the product is clearly there. `;
  return "";
}

/** A short, human clause for each gap, written to drop into "the main one being that ___". */
const WA_GAP: Partial<Record<Opportunity, string>> = {
  needs_website: "you don't have a website yet, so people who find you online can't book or look around",
  broken_website: "your website is down, so the link from Google leads to an error",
  outdated_stack: "your site is on a dated builder that loads slowly and is hard to rank",
  no_mobile: "your site doesn't work properly on phones, which is where most people find you",
  no_https: "your site isn't secure, so browsers warn visitors before they even land",
  slow_site: "your site takes over five seconds to load, and most people leave before it opens",
  weak_seo: "you're not showing up when tourists search for places in your area",
  thin_content: "your pages are thin, so they don't build trust or rank on Google",
  no_social: "I couldn't find any social profiles, which is where most discovery happens here",
  no_instagram: "you're not on Instagram, which is the number one way people find places in Bali",
  dormant_social: "your socials look inactive, which quietly puts people off",
  social_only: "you're relying only on socials, so you can't take direct bookings or be found on Google",
  no_analytics: "there's no analytics installed, so you can't see what's actually working",
  no_marketing: "there's no marketing setup, so growth depends on walk-ins",
  no_email_capture: "there's no way to capture visitors, so the traffic you earn just leaves",
  no_booking: "there's no online booking, so every reservation turns into a back-and-forth",
  no_contact_capture: "your contact details are hard to find, so people give up before reaching you",
  low_reviews: "you have very few reviews, which costs you against busier-looking competitors",
  weak_reputation: "your rating is sitting low, which puts people off right at the decision point",
  no_content: "there's no fresh content, so you're missing the searches that bring new customers",
};

function topGap(lead: Lead): string {
  const o = (lead.opportunities ?? [])[0];
  return o ? (WA_GAP[o] ?? "") : "";
}

const SOCIAL_NAME: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok",
  linkedin: "LinkedIn", twitter: "X", youtube: "YouTube",
};

/**
 * Name a social platform we actually know they're on: first from the socials we
 * discovered, otherwise from the link their Google listing points at. Returns
 * null when we have no evidence of any social account (so we never invent one).
 */
function namedSocial(lead: Lead): string | null {
  // Prefer the merged socials we discovered (website + Maps + web search).
  const s = (lead.socials ?? lead.audit?.socials) as Record<string, string | null> | undefined;
  if (s) { for (const k of Object.keys(SOCIAL_NAME)) if (s[k]) return SOCIAL_NAME[k]; }
  const url = (lead.websiteFromMaps || lead.url || "").toLowerCase();
  for (const k of Object.keys(SOCIAL_NAME)) if (url.includes(k)) return SOCIAL_NAME[k];
  if (url.includes("fb.me") || url.includes("fb.com")) return "Facebook";
  return null;
}

const humanFollowers = (n: number): string =>
  n >= 1_000_000 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  : n >= 10_000 ? Math.round(n / 1000) + "K"
  : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K"
  : String(n);

/** The social account with the largest real following (1k+), if we measured one. */
function audience(lead: Lead): { platform: string; followers: number } | null {
  let best: { platform: string; followers: number } | null = null;
  for (const s of lead.socialInsights ?? []) {
    if (s.followers && s.followers >= 1000 && (!best || s.followers > best.followers)) {
      best = { platform: s.platform, followers: s.followers };
    }
  }
  return best;
}

// ----------------------------------------------------------------------------
// WhatsApp: short, personal, with a clear low-friction close
// ----------------------------------------------------------------------------

export function buildWhatsApp(lead: Lead): string {
  const ws = lead.websiteStatus;
  const area = inArea(lead);
  const pr = proof(lead);
  const close = "Want me to send it over? It's free and takes about two minutes to read.";

  const aud = audience(lead);

  // 1) Their listing's "website" is actually a social page, not a real site.
  if (lead.isSocialUrl) {
    const soc = namedSocial(lead) ?? "a social page";
    const follow = aud ? ` where you've built ${humanFollowers(aud.followers)} followers` : "";
    return `Hi! I found ${lead.name}${area} on Google Maps. ${pr}The link on your listing goes to your ${soc}${follow} rather than an actual website, so people can't book with you directly and you're hard to find through Google search. I'm ${me}. ${whatWeDo} I've put together a free audit showing what a proper website would change and the quickest wins. ${close}`;
  }

  // 2) They DO have a website, but it's down or erroring right now.
  if (ws === "unreachable")
    return `Hi! I just tried to open ${possessive(lead.name)} website and it looks like it's down, so the link on your Google listing is sending people to an error right now. ${pr}I'm ${me}. ${whatWeDo} I've put together a quick free audit with what's broken and how to get it working fast. ${close}`;

  // 3) No website at all. Adapt depending on whether they're at least on socials.
  if (ws === "none") {
    const soc = namedSocial(lead);
    if (aud)
      return `Hi! I came across ${lead.name}${area} on Google Maps and had a look. ${pr}You've built ${humanFollowers(aud.followers)} followers on ${aud.platform}, which is brilliant, but I couldn't find an actual website anywhere, so there's nothing turning that audience into direct bookings or Google search traffic. I'm ${me}. ${whatWeDo} I've put together a free audit showing how to convert that following and the quickest wins. ${close}`;
    if (soc)
      return `Hi! I came across ${lead.name}${area} on Google Maps and had a look. ${pr}You're on ${soc}, which is a good start, but I couldn't find an actual website anywhere, so people can't book with you directly and you're missing out on Google search. I'm ${me}. ${whatWeDo} I've put together a free audit showing where you're losing customers and the quickest ways to win them back. ${close}`;
    return `Hi! I came across ${lead.name}${area} on Google Maps. ${pr}I couldn't find a website for you anywhere, so anyone who looks you up online has no real way to see more or book. I'm ${me}. ${whatWeDo} I've put together a free audit of your online presence showing where you're losing customers and the quickest ways to win them back. ${close}`;
  }

  // 4) Working website: lead with the single biggest gap.
  const gap = topGap(lead);
  if (gap)
    return `Hi! I had a proper look at ${lead.name}${area} online. ${pr}A few things stood out that are quietly costing you customers, the main one being that ${gap}. I'm ${me}. ${whatWeDo} I've put together a free audit that lays out your three biggest wins and exactly how to get them. ${close}`;

  return `Hi! ${lead.name} already has a solid presence online${area}, nice work. ${pr}I had a look anyway and spotted a couple of smaller wins worth grabbing. I'm ${me}. ${whatWeDo} I put it all in a quick free audit, want me to send it over? No obligation, it's a two-minute read.`;
}

// ----------------------------------------------------------------------------
// Email: a touch longer, same personalisation
// ----------------------------------------------------------------------------

/** The descriptive opening line for email, without any call to action. */
function emailOpener(lead: Lead): string {
  const area = inArea(lead);
  const pr = proof(lead);
  const ws = lead.websiteStatus;

  const aud = audience(lead);

  if (lead.isSocialUrl) {
    const soc = namedSocial(lead) ?? "a social page";
    const follow = aud ? ` (where you've built ${humanFollowers(aud.followers)} followers)` : "";
    return `I found ${lead.name}${area} on Google Maps, and the link on your listing goes to your ${soc}${follow} rather than an actual website. ${pr}I'm ${me}. ${whatWeDo}`;
  }
  if (ws === "unreachable")
    return `I tried to open ${possessive(lead.name)} website and it looks like it's down right now. ${pr}I'm ${me}. ${whatWeDo}`;
  if (ws === "none") {
    const soc = namedSocial(lead);
    if (aud)
      return `I came across ${lead.name}${area} on Google Maps. You've built ${humanFollowers(aud.followers)} followers on ${aud.platform}, but I couldn't find an actual website turning that audience into bookings. ${pr}I'm ${me}. ${whatWeDo}`;
    if (soc)
      return `I came across ${lead.name}${area} on Google Maps. You're on ${soc}, but I couldn't find an actual website for you anywhere. ${pr}I'm ${me}. ${whatWeDo}`;
    return `I came across ${lead.name}${area} on Google Maps but couldn't find a website for you anywhere. ${pr}I'm ${me}. ${whatWeDo}`;
  }
  const gap = topGap(lead);
  if (gap)
    return `I had a look at ${lead.name}${area} online and spotted a few things that could bring you more bookings, the main one being that ${gap}. ${pr}I'm ${me}. ${whatWeDo}`;
  return `${lead.name} already has a strong online presence${area}. ${pr}I'm ${me}. ${whatWeDo}`;
}

export function buildEmail(lead: Lead): { subject: string; body: string } {
  const ws = lead.websiteStatus;
  const subject =
    lead.isSocialUrl ? `A quick idea for ${possessive(lead.name)} online presence`
    : ws === "unreachable" ? `${possessive(lead.name)} website looks to be down`
    : ws === "none" ? `A quick idea for ${possessive(lead.name)} online presence`
    : `A few quick wins for ${lead.name}`;
  const body =
`Hi,

${emailOpener(lead)}

If you'd like, I can send over a short free audit with the specifics. No obligation at all.

Cheers,
${BRAND.sender}
${BRAND.name} · ${BRAND.tagline}
WhatsApp ${BRAND.whatsapp} · ${BRAND.site}`;
  return { subject, body };
}
