// lib/outreach.ts
// Ready-to-send first-contact messages, tailored to each lead.
import { Lead } from "./types";
import { BRAND } from "./brand";

const me = `${BRAND.sender} from ${BRAND.name}`;

/** Normalise a lead's number for a wa.me link (digits only, local 0 -> 62). */
export function waRecipient(lead: Lead): string | null {
  const raw = (lead.whatsapp || lead.phone || "").replace(/[^\d]/g, "");
  if (raw.length < 8) return null;
  return raw.startsWith("0") ? "62" + raw.slice(1) : raw;
}

/** The descriptive opening line, without any call to action. */
function opener(lead: Lead): string {
  const ws = lead.websiteStatus;
  if (ws === "none")
    return `I came across ${lead.name} on Google Maps but couldn't find a website for you anywhere. I'm ${me}, we build websites and run socials and marketing for Bali businesses.`;
  if (ws === "unreachable")
    return `I tried to open ${lead.name}'s website and it looks like it's down right now. I'm ${me}, we build and look after websites for Bali businesses.`;
  const opps = lead.opportunities ?? [];
  if (opps.length)
    return `I had a look at ${lead.name} online and spotted a few things that could bring you more bookings. I'm ${me}, we help Bali businesses with their website, socials and marketing.`;
  return `${lead.name} already has a strong online presence. I'm ${me}, we work with Bali businesses on websites, socials and marketing.`;
}

export function buildWhatsApp(lead: Lead): string {
  return `Hi! ${opener(lead)} I put together a quick free audit of your online presence. Want me to send it over?`;
}

export function buildEmail(lead: Lead): { subject: string; body: string } {
  const ws = lead.websiteStatus;
  const subject =
    ws === "none" ? `A quick idea for ${lead.name}'s online presence`
    : ws === "unreachable" ? `${lead.name}'s website looks to be down`
    : `A few quick wins for ${lead.name}`;
  const body =
`Hi,

${opener(lead)}

If you'd like, I can send over a short free audit with the specifics. No obligation at all.

Cheers,
${BRAND.sender}
${BRAND.name} · ${BRAND.tagline}
WhatsApp ${BRAND.whatsapp} · ${BRAND.site}`;
  return { subject, body };
}
