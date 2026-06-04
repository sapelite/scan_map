// lib/types.ts

export interface Socials {
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  twitter: string | null;
  tiktok: string | null;
  youtube: string | null;
}

export interface WebsiteAudit {
  httpStatus: number;
  httpsActive: boolean;
  finalUrl: string;
  redirected: boolean;
  loadTimeMs: number;
  reachable: boolean;

  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;

  h1Count: number;
  h2Count: number;
  wordCount: number;
  imageCount: number;
  imagesWithAlt: number;
  internalLinks: number;
  externalLinks: number;

  mobileViewport: boolean;
  ogTagCount: number;
  twitterCard: boolean;
  jsonLd: boolean;

  hasRobotsTxt: boolean;
  hasSitemap: boolean;

  hasGoogleAnalytics: boolean;
  hasGoogleTagManager: boolean;
  hasFacebookPixel: boolean;
  hasHubSpot: boolean;

  // --- marketing maturity signals ---
  adPixels: string[];          // e.g. ["Meta Pixel", "Google Ads", "TikTok Pixel"]
  hasEmailCapture: boolean;    // newsletter / email input form present
  hasBooking: boolean;         // online booking / ordering / reservation CTA
  hasLiveChat: boolean;        // chat widget (Intercom, Tawk, Crisp, WhatsApp chat, ...)

  // --- content signals ---
  hasBlog: boolean;            // /blog /news /articles section detected

  // --- deep crawl ---
  pagesCrawled?: number;       // how many pages a deep audit visited (1 = homepage only)
  // --- real performance (Google PageSpeed Insights, fetched only on a deep audit) ---
  psiPerformance?: number;     // Lighthouse performance score 0-100 (mobile)
  psiLcpMs?: number;           // Largest Contentful Paint, ms
  psiCls?: number;             // Cumulative Layout Shift

  tech: string[];
  emails: string[];
  phones: string[];
  whatsapp: string | null;
  socials: Socials;
  socialCount: number;         // distinct social platforms linked from the site
  isSocialOnly: boolean;
}

export type Opportunity =
  // website
  | "needs_website"          // no website at all
  | "broken_website"         // unreachable
  | "outdated_stack"         // Wix / Squarespace / old WordPress
  | "no_mobile"              // missing mobile viewport
  | "no_https"               // not HTTPS
  | "slow_site"              // > 5s load
  | "weak_seo"               // site dimension < 40
  | "thin_content"           // < 200 words
  // social
  | "no_social"              // no social profiles linked anywhere
  | "no_instagram"           // no Instagram (critical for Bali hospitality)
  | "dormant_social"         // only 1 platform / weak social footprint
  | "social_only"            // present on socials but no real website
  // marketing
  | "no_analytics"           // no GA/GTM
  | "no_marketing"           // no ad pixels / analytics at all
  | "no_email_capture"       // no lead-capture form
  | "no_booking"             // no online booking / ordering / reservation
  | "no_contact_capture"     // no email/phone/whatsapp on site
  // reputation
  | "low_reviews"            // very few Google reviews
  | "weak_reputation"        // low rating
  // content
  | "no_content";            // no blog / fresh content section


export interface ScoreFactor {
  label: string;
  weight: number;
  awarded: number;
  ok: boolean;
  value?: string;
}

export type WebsiteStatus = "none" | "unreachable" | "audited";

/** The five dimensions of the combined Digital Presence score. */
export type PresenceKey = "site" | "social" | "marketing" | "reputation" | "content";

export interface PresenceDimensions {
  site: number;        // website quality (0-100)
  social: number;      // social presence & activity (0-100)
  marketing: number;   // marketing maturity (0-100)
  reputation: number;  // reputation & local SEO (0-100)
  content: number;     // content quality (0-100)
}

/** A scored dimension with the factors that produced it (for the breakdown UI). */
export interface DimensionBreakdown {
  key: PresenceKey;
  label: string;
  score: number;       // 0-100 for this dimension
  weight: number;      // its share of the overall presence score
  blurb: string;       // plain-English explanation of what this dimension measures
  factors: ScoreFactor[];
}

export interface Lead {
  id: string;
  name: string;
  url: string;                         // best-known canonical URL (final after audit, or maps-listed)
  websiteFromMaps?: string | null;     // raw URL Maps exposed (may differ from final URL)
  websiteStatus: WebsiteStatus;
  websiteFailReason?: string | null;   // human-readable reason if unreachable
  auditAttempts?: string[];            // per-attempt log: every URL tried + outcome
  email: string;
  whatsapp?: string | null;
  opportunities?: Opportunity[];
  tech: string;
  category?: string;                   // business category / niche (from the sweep query)
  rating: number;
  reviews: string;                     // raw reviews label from Maps (kept for display)
  reviewCount: number;                 // parsed numeric review count
  address: string;
  phone: string;
  mapsUrl: string;
  isSocialUrl: boolean;
  authorityScore: number;
  date?: string;
  status?: string;
  contactedAt?: string;                // ISO timestamp set when first marked CONTACTED
  notes?: string;
  lastAuditedAt?: string;
  stats: {
    score: number;                     // OVERALL Digital Presence score 0-100
    riskLevel: "Critical" | "High Risk" | "Medium" | "Low";
    dimensions?: PresenceDimensions;   // the 5 sub-scores
  };
  scoreFactors?: ScoreFactor[];        // legacy: website/SEO factors (kept for PDF + back-compat)
  dimensionFactors?: DimensionBreakdown[]; // full per-dimension breakdown for the detail view
  audit?: WebsiteAudit;
  deepReport?: DeepReport;             // produced by an on-demand Deep audit
  socials?: Socials;                   // best-known socials: website links + Maps panel + web search
  socialsSource?: ("website" | "maps" | "search")[]; // where each social signal came from
  socialInsights?: SocialCheck[];      // enriched per-account public stats (followers, posts, etc.)
  pitch: string;
}

/** Best-effort check of one social account (platforms often gate public data). */
export interface SocialCheck {
  platform: string;
  url: string;
  live: boolean;          // page reachable (not 404/unreachable)
  title: string | null;   // og:title / page title if exposed
  note: string;           // e.g. "public data limited (login wall)" or "unreachable"
  // --- public stats, when the platform exposes them (Instagram, TikTok) ---
  handle?: string;        // @handle
  followers?: number;     // follower / like-page count
  following?: number;
  posts?: number;         // posts / videos
  verified?: boolean;     // blue tick
  bio?: string;           // profile bio / description
  email?: string;         // public contact email exposed on the profile, if any
}

/** A deep, on-demand dossier: a full website crawl plus best-effort social checks. */
export interface DeepReport {
  ranAt: string;
  sitemapFound: boolean;
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesMissingTitle: number;
  pagesMissingMeta: number;
  totalImages: number;
  pageWeightKb: number;     // homepage HTML size
  scriptCount: number;      // scripts on the homepage
  brokenLinks: string[];    // internal links returning >= 400
  hasFreshContent: boolean; // a dated item within ~4 months
  latestContentDate: string | null;
  socials: SocialCheck[];
}

export type LeadStatus = "NEW" | "CONTACTED" | "CLOSED" | "REJECTED";

export const STATUS_OPTIONS: LeadStatus[] = ["NEW", "CONTACTED", "CLOSED", "REJECTED"];

export interface OpportunityInfo {
  short: string;   // chip label
  long: string;    // one-line finding
  sell: string;    // the service it maps to (internal / admin)
  why: string;     // why it matters to the business (client-facing)
  fix: string;     // how to fix it / what we'd do (client-facing)
}

/** Human-readable detail for each opportunity. Drives the UI, the client PDF
 *  ("why it matters" + "how to fix"), and the internal report ("sell"). */
export const OPPORTUNITY_META: Record<Opportunity, OpportunityInfo> = {
  needs_website: {
    short: "Needs website", long: "No website on their Google listing", sell: "Website build",
    why: "Anyone who wants to check you out before they visit or book has nowhere to go, and you're invisible in Google search beyond the map.",
    fix: "Build a fast, mobile-first website with your story, offerings, photos, and an easy way to book or get in touch.",
  },
  broken_website: {
    short: "Broken site", long: "Website is down or unreachable", sell: "Website rebuild",
    why: "A dead website is worse than none. People click the link, hit an error, and assume you've closed.",
    fix: "Rebuild on reliable hosting with a secure, maintained site so the link from Google always works.",
  },
  outdated_stack: {
    short: "Outdated stack", long: "Built on a dated DIY platform (Wix/Squarespace)", sell: "Migration / redesign",
    why: "Template builders are slow, hard to rank, and look generic. They cap how far your brand and your SEO can grow.",
    fix: "Migrate to a fast, custom-built site you fully own, optimised for speed and search.",
  },
  no_mobile: {
    short: "Not mobile", long: "No mobile layout, breaks on phones", sell: "Responsive redesign",
    why: "Most Bali tourists browse on their phone. A site that breaks on mobile loses them in seconds, and Google pushes it down the rankings.",
    fix: "Rebuild it responsively so it looks great on every phone, tablet, and desktop.",
  },
  no_https: {
    short: "No HTTPS", long: "Not secure, no SSL certificate", sell: "Security + rebuild",
    why: "Browsers show a 'Not secure' warning that scares people off, and Google ranks insecure sites lower.",
    fix: "Install SSL and serve the whole site over HTTPS.",
  },
  slow_site: {
    short: "Slow", long: "Page takes over 5 seconds to load", sell: "Performance overhaul",
    why: "More than half of visitors leave if a page takes longer than 3 seconds. Slow sites lose bookings and rank worse.",
    fix: "Optimise images, hosting, and code to get loads under 2 seconds.",
  },
  weak_seo: {
    short: "Weak SEO", long: "Poor on-page SEO fundamentals", sell: "SEO package",
    why: "Without solid SEO you don't show up when tourists search for the best place in your area. You only get people who already know you.",
    fix: "Fix titles, meta, structure, and local keywords so you rank for the searches that bring customers.",
  },
  thin_content: {
    short: "Thin content", long: "Very little text, looks unfinished", sell: "Copywriting + content",
    why: "Thin pages don't build trust and give Google nothing to rank. Visitors leave without the info they came for.",
    fix: "Write compelling, keyword-rich pages that sell your experience and answer customer questions.",
  },
  no_social: {
    short: "No socials", long: "No social profiles found anywhere", sell: "Social setup + management",
    why: "In Bali, social proof is the storefront. No socials means no discovery, no trust, and no word of mouth.",
    fix: "Set up and brand Instagram and Facebook, then run a consistent content calendar.",
  },
  no_instagram: {
    short: "No Instagram", long: "No Instagram, essential for Bali hospitality", sell: "Instagram setup + content",
    why: "Instagram is the number one way tourists discover places in Bali. Not being there means missing your biggest discovery channel.",
    fix: "Launch a branded Instagram with reels, stories, and a posting schedule we manage for you.",
  },
  dormant_social: {
    short: "Dormant social", long: "Barely any social footprint", sell: "Social content + management",
    why: "A near-empty or single-platform presence tells potential customers (and the algorithm) that you're inactive.",
    fix: "Take over content creation and posting across the platforms that matter to your audience.",
  },
  social_only: {
    short: "Social only", long: "Lives on socials with no real website", sell: "Website + presence",
    why: "Relying only on Instagram means you don't own your audience, you can't be found on Google, and you can't take direct bookings.",
    fix: "Build a website hub that turns your social following into direct bookings and search traffic.",
  },
  no_analytics: {
    short: "No analytics", long: "No analytics installed, flying blind", sell: "Analytics setup",
    why: "Without analytics you can't see where customers come from or what's working. Every marketing decision is a guess.",
    fix: "Install analytics and conversion tracking so every campaign is measurable.",
  },
  no_marketing: {
    short: "No marketing", long: "No tracking, ads, or lead capture at all", sell: "Marketing strategy",
    why: "With no marketing setup you can't run ads, retarget visitors, or grow predictably. You're stuck relying on walk-ins.",
    fix: "Set up a full marketing stack (tracking, ads, retargeting, email) with a strategy to grow bookings.",
  },
  no_email_capture: {
    short: "No lead capture", long: "No newsletter or email capture form", sell: "Funnel + email marketing",
    why: "Visitors leave and you have no way to bring them back. That's traffic you paid for in effort and can't re-use.",
    fix: "Add a lead-capture offer and an email flow that turns first-time visitors into repeat customers.",
  },
  no_booking: {
    short: "No booking", long: "No online booking, ordering, or reservations", sell: "Booking integration",
    why: "Every booking handled by DM or phone tag is friction, and friction loses you customers to competitors who let people book instantly.",
    fix: "Add online booking or ordering so customers can commit in one tap, any time of day.",
  },
  no_contact_capture: {
    short: "No contact", long: "No email, phone, or WhatsApp on the site", sell: "Contact + conversion",
    why: "If people can't reach you quickly, they move on to the next option. You lose the sale right at the finish line.",
    fix: "Add clear contact options (WhatsApp, phone, form) on every page.",
  },
  low_reviews: {
    short: "Few reviews", long: "Very few Google reviews", sell: "Reputation campaign",
    why: "Tourists pick the place with more and better reviews. A thin review count quietly costs you bookings.",
    fix: "Run a review campaign that systematically asks happy customers to post.",
  },
  weak_reputation: {
    short: "Low rating", long: "Below-average star rating", sell: "Reputation management",
    why: "A low star rating is the biggest deterrent in the moment someone decides. It caps how many people ever contact you.",
    fix: "Fix the recurring complaints, respond to reviews, and rebuild the rating with a reputation programme.",
  },
  no_content: {
    short: "No content", long: "No blog or fresh content", sell: "Content creation",
    why: "Fresh content is what ranks for long-tail searches and keeps your brand top of mind. Without it, growth stalls.",
    fix: "Produce a steady stream of blog posts, guides, and social content tied to what your customers search for.",
  },
};
