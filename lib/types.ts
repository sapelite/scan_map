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

  tech: string[];
  emails: string[];
  phones: string[];
  socials: Socials;
  isSocialOnly: boolean;
}

export interface ScoreFactor {
  label: string;
  weight: number;
  awarded: number;
  ok: boolean;
  value?: string;
}

export type WebsiteStatus = "none" | "unreachable" | "audited";

export interface Lead {
  id: string;
  name: string;
  url: string;                         // best-known canonical URL (final after audit, or maps-listed)
  websiteFromMaps?: string | null;     // raw URL Maps exposed (may differ from final URL)
  websiteStatus: WebsiteStatus;
  websiteFailReason?: string | null;   // human-readable reason if unreachable
  auditAttempts?: string[];            // per-attempt log: every URL tried + outcome
  email: string;
  tech: string;
  rating: number;
  reviews: string;
  address: string;
  phone: string;
  mapsUrl: string;
  isSocialUrl: boolean;
  authorityScore: number;
  date?: string;
  status?: string;
  notes?: string;
  lastAuditedAt?: string;
  stats: {
    score: number;
    riskLevel: "Critical" | "High Risk" | "Medium" | "Low";
  };
  scoreFactors?: ScoreFactor[];
  audit?: WebsiteAudit;
  pitch: string;
}

export type LeadStatus = "NEW" | "CONTACTED" | "CLOSED" | "REJECTED";

export const STATUS_OPTIONS: LeadStatus[] = ["NEW", "CONTACTED", "CLOSED", "REJECTED"];
