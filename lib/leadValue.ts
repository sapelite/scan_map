// lib/leadValue.ts
// How good a PROSPECT a lead is, 0-100 (higher = hotter). The weakest digital
// presence isn't automatically the best lead: the best lead is one that has a
// lot to gain (opportunity), is big enough to pay (audience/reviews), and can
// actually be reached. This composite is what the Library sorts by.
import { Lead } from "./types";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Largest follower count we measured across their social accounts. */
export function maxFollowers(lead: Lead): number {
  return (lead.socialInsights ?? []).reduce((m, s) => Math.max(m, s.followers ?? 0), 0);
}

/** How many ways we can actually contact them right now (phone / WhatsApp / email). */
export function contactChannels(lead: Lead): number {
  let n = 0;
  if (lead.phone && lead.phone !== "No Phone") n++;
  if (lead.whatsapp) n++;
  if (lead.email && !/^no email/i.test(lead.email)) n++;
  return n;
}

export function leadValue(lead: Lead): number {
  const presence = lead.stats?.score ?? 50;
  const opportunity = (100 - presence) / 100;                       // weak presence = more to sell

  const reviewNorm = clamp01((lead.reviewCount || 0) / 200);        // 200+ reviews ~ established
  const followerNorm = clamp01(maxFollowers(lead) / 50000);         // 50k+ followers ~ big audience
  const size = Math.max(reviewNorm, followerNorm);                  // either signal means "can pay"

  const channels = contactChannels(lead);
  const reach = channels === 0 ? 0 : channels === 1 ? 0.6 : 1;      // unreachable = worthless to pitch

  const rep = clamp01((lead.rating || 0) / 5);                      // a real, liked business

  const score = opportunity * 40 + size * 35 + reach * 15 + rep * 10;
  return Math.round(score);
}

/** A short band label for the score, for chips/badges. */
export function valueBand(v: number): "Hot" | "Warm" | "Cool" {
  return v >= 66 ? "Hot" : v >= 40 ? "Warm" : "Cool";
}

// ---- follow-up tracking ----------------------------------------------------

/** Whole days since the lead was first contacted, or null if never. */
export function daysSinceContact(lead: Lead): number | null {
  if (!lead.contactedAt) return null;
  const t = Date.parse(lead.contactedAt);
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** Contacted, still not closed/rejected, and it's been a few days with no movement. */
export function followUpDue(lead: Lead, afterDays = 3): boolean {
  if ((lead.status || "NEW").toUpperCase() !== "CONTACTED") return false;
  const d = daysSinceContact(lead);
  return d !== null && d >= afterDays;
}
