import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';
import {
  Lead, WebsiteAudit, ScoreFactor, Socials, WebsiteStatus,
} from './types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const SOCIAL_DOMAINS = [
  'instagram.com', 'facebook.com', 'linktr.ee', 'tiktok.com',
  'linkedin.com', 'twitter.com', 'x.com', 'youtube.com',
];

const NOISE_EMAILS = [
  'example.', 'your.email', 'sentry.io', 'wixpress', 'jpg', 'png', 'gif', 'svg',
  '@2x', '@3x', 'sentry-next', 'sentry@',
];

const delay = (min: number, max: number) =>
  new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

// ============ MAPS DISCOVERY ============

interface MapsTarget {
  name: string;
  rating: number;
  reviews: string;
  website: string | null;          // best URL we found in Maps (after unwrapping)
  rawWebsite: string | null;       // original href (before unwrap) — for debug
  address: string;
  phone: string;
  mapsUrl: string;
  authorityScore: number;
}

/** Decode Google's redirect wrapper (https://www.google.com/url?q=...) */
function unwrapGoogleRedirect(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname.endsWith('google.com') && (u.pathname === '/url' || u.pathname === '/aclk')) {
      const q = u.searchParams.get('q') || u.searchParams.get('url');
      if (q && /^https?:\/\//i.test(q)) return q;
    }
  } catch { /* not a URL */ }
  return href;
}

/** Returns true if this URL points to the actual Maps page itself (not the business). */
function isMapsInternalUrl(href: string): boolean {
  return /(^https?:\/\/)?(www\.)?(google\.[a-z.]+|gstatic\.com|googleapis\.com|googleusercontent\.com|googlemaps\.com)/i.test(href);
}

async function dismissConsent(page: Page) {
  try {
    await delay(1000, 2000);
    const buttons = await page.$$('button');
    for (const button of buttons) {
      const text = await page.evaluate((el) => (el as HTMLElement).innerText, button);
      if (/accept all|i agree|agree|accepter/i.test(text)) {
        await button.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
        break;
      }
    }
  } catch { /* ignore */ }
}

async function discoverPlaceLinks(browser: Browser, niche: string, location: string, scanLimit: number): Promise<string[]> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    const query = encodeURIComponent(`${niche} in ${location}`);
    const searchUrl = `https://www.google.com/maps/search/${query}?hl=en`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await dismissConsent(page);

    const resultsSelector = 'div[role="feed"], [aria-label*="Results for"]';
    await page.waitForSelector(resultsSelector, { timeout: 20000 });

    let linksFound = 0;
    let sameCountCycles = 0;
    while (linksFound < scanLimit && sameCountCycles < 3) {
      const prevCount = linksFound;
      await page.evaluate(() => {
        const scrollable = document.querySelector('div[role="feed"]') || window;
        scrollable.scrollBy(0, 1000);
      });
      await delay(1500, 2500);
      linksFound = await page.evaluate(() => document.querySelectorAll('a[href*="/maps/place/"]').length);
      if (prevCount === linksFound) sameCountCycles++;
      else sameCountCycles = 0;
    }

    return await page.evaluate((limit) =>
      Array.from(document.querySelectorAll('a'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(href => href.includes('/maps/place/'))
        .slice(0, limit),
    scanLimit);
  } finally {
    await page.close();
  }
}

/**
 * Multi-strategy website extraction from a Google Maps place page.
 * Tries (in order):
 *   1. Specific known selectors  (data-item-id="authority", aria-label*="Website")
 *   2. Buttons whose visible text is "Website"
 *   3. Any external link in the side panel that isn't a Google/social domain
 * Then unwraps any Google redirect wrappers.
 */
async function extractMapsTarget(browser: Browser, link: string): Promise<MapsTarget | null> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('h1', { timeout: 10000 });
    // Let the side panel fully populate (Maps lazy-loads details)
    await delay(800, 1500);

    const details = await page.evaluate(() => {
      const getText = (el: Element | null) => (el as HTMLElement | null)?.innerText || '';
      const name = getText(document.querySelector('h1')) || 'Unknown Business';

      const ratingStr = document.querySelector('span[role="img"][aria-label*="stars"]')
        ?.getAttribute('aria-label')?.split(' ')[0];
      const rating = parseFloat(ratingStr || '0');
      const reviews = getText(document.querySelector('button[aria-label*="reviews"]')) || '0';

      // ----- Multi-strategy website extraction -----
      const candidateSelectors = [
        'a[data-item-id="authority"]',
        'a[aria-label^="Website"]',
        'a[aria-label*="ebsite"]',           // matches "Website", "website", "ebsite"
        'a[data-tooltip*="ebsite"]',
        'a[data-value="Website"]',
        'a[jsaction*="placeWebsiteLink"]',
      ];
      let website: string | null = null;
      let raw: string | null = null;
      for (const sel of candidateSelectors) {
        const el = document.querySelector(sel) as HTMLAnchorElement | null;
        if (el?.href) { website = el.href; raw = el.getAttribute('href'); break; }
      }

      // Fallback: look for buttons/anchors whose visible text reads "Website"
      if (!website) {
        const all = Array.from(document.querySelectorAll('a, button')) as HTMLElement[];
        const hit = all.find((el) => {
          const t = (el.innerText || '').trim().toLowerCase();
          return t === 'website' || t.startsWith('website ') || t.endsWith(' website');
        });
        if (hit && hit.tagName === 'A') {
          const a = hit as HTMLAnchorElement;
          website = a.href;
          raw = a.getAttribute('href');
        }
      }

      // Last-ditch fallback: any external http link in the side panel that isn't Google/social
      if (!website) {
        const sidePanel = document.querySelector('div[role="main"]') || document.body;
        const links = Array.from(sidePanel.querySelectorAll('a[href^="http"]')) as HTMLAnchorElement[];
        const isExcluded = (h: string) =>
          /google\.[a-z.]+|gstatic|googleusercontent|googlemaps|googleapis/i.test(h) ||
          /(maps|search|images)\.google/i.test(h);
        const cand = links.find(a => !isExcluded(a.href));
        if (cand) { website = cand.href; raw = cand.getAttribute('href'); }
      }

      const address = document.querySelector('button[data-item-id="address"]')
        ?.getAttribute('aria-label')?.replace(/^Address:\s*/i, '') || '';
      const phone = document.querySelector('button[data-item-id*="phone"]')
        ?.getAttribute('aria-label')?.replace(/^Phone:\s*/i, '') || '';

      return { name, rating, reviews, website, raw, address, phone };
    });

    let website = details.website;
    if (website) {
      website = unwrapGoogleRedirect(website);
      // If after unwrap it's still a Google domain, treat as no website
      if (isMapsInternalUrl(website)) website = null;
    }

    return {
      name: details.name,
      rating: details.rating,
      reviews: details.reviews,
      website,
      rawWebsite: details.raw,
      address: details.address || 'No Address',
      phone: details.phone || 'No Phone',
      mapsUrl: link,
      authorityScore: (details.rating || 0) * 10,
    };
  } catch {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// ============ HTML ANALYSIS (shared between fetch strategies) ============

function findFirst(html: string, regex: RegExp): string | null {
  const m = html.match(regex);
  return m ? m[0] : null;
}

function extractSocials(html: string): Socials {
  return {
    instagram: findFirst(html, /https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+/i),
    facebook:  findFirst(html, /https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9_.\-/]+/i),
    linkedin:  findFirst(html, /https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_\-%]+/i),
    twitter:   findFirst(html, /https?:\/\/(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]+/i),
    tiktok:    findFirst(html, /https?:\/\/(www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/i),
    youtube:   findFirst(html, /https?:\/\/(www\.)?youtube\.com\/(@|channel\/|user\/|c\/)[A-Za-z0-9_\-]+/i),
  };
}

function detectTech(lower: string, $: cheerio.CheerioAPI): string[] {
  const tech = new Set<string>();
  if (lower.includes('wp-content') || lower.includes('wp-includes')) tech.add('WordPress');
  if (lower.includes('cdn.shopify') || lower.includes('shopify.com')) tech.add('Shopify');
  if (lower.includes('static.wixstatic') || lower.includes('wix.com')) tech.add('Wix');
  if (lower.includes('squarespace.com') || lower.includes('static1.squarespace')) tech.add('Squarespace');
  if (lower.includes('webflow.io') || lower.includes('webflow.com') || $('[data-wf-page]').length > 0) tech.add('Webflow');
  if (lower.includes('_next/static') || $('#__next').length > 0) tech.add('Next.js');
  if (lower.includes('data-reactroot') || lower.includes('react-dom')) tech.add('React');
  if (lower.includes('vue.runtime') || $('[data-server-rendered]').length > 0) tech.add('Vue');
  if ($('[class*="elementor-"]').length > 0) tech.add('Elementor');
  if (lower.includes('jquery')) tech.add('jQuery');
  if (lower.includes('bootstrap.min.css') || lower.includes('bootstrap.bundle')) tech.add('Bootstrap');
  if (lower.includes('framer.com') || lower.includes('framerusercontent')) tech.add('Framer');
  return [...tech];
}

function buildEmptyAudit(finalUrl: string): WebsiteAudit {
  return {
    httpStatus: 0,
    httpsActive: false,
    finalUrl,
    redirected: false,
    loadTimeMs: 0,
    reachable: false,
    title: null, titleLength: 0,
    metaDescription: null, metaDescriptionLength: 0,
    canonical: null,
    h1Count: 0, h2Count: 0, wordCount: 0,
    imageCount: 0, imagesWithAlt: 0,
    internalLinks: 0, externalLinks: 0,
    mobileViewport: false,
    ogTagCount: 0, twitterCard: false, jsonLd: false,
    hasRobotsTxt: false, hasSitemap: false,
    hasGoogleAnalytics: false, hasGoogleTagManager: false,
    hasFacebookPixel: false, hasHubSpot: false,
    tech: [],
    emails: [], phones: [],
    socials: { instagram: null, facebook: null, linkedin: null, twitter: null, tiktok: null, youtube: null },
    isSocialOnly: false,
  };
}

function analyzeHtml(html: string, finalUrl: string): WebsiteAudit {
  const audit = buildEmptyAudit(finalUrl);
  audit.reachable = true;
  audit.httpsActive = finalUrl.startsWith('https://');

  const lower = html.toLowerCase();
  const $ = cheerio.load(html);

  let finalDomain = '';
  try { finalDomain = new URL(finalUrl).hostname.toLowerCase(); } catch {}
  audit.isSocialOnly = SOCIAL_DOMAINS.some(d => finalDomain.includes(d));

  const title = $('head title').first().text().trim();
  audit.title = title || null;
  audit.titleLength = title.length;

  const desc = $('meta[name="description"]').attr('content')?.trim() || '';
  audit.metaDescription = desc || null;
  audit.metaDescriptionLength = desc.length;

  audit.canonical = $('link[rel="canonical"]').attr('href')?.trim() || null;
  audit.h1Count = $('h1').length;
  audit.h2Count = $('h2').length;

  const body = $('body').clone();
  body.find('script, style, noscript').remove();
  const words = body.text().trim().split(/\s+/).filter(Boolean);
  audit.wordCount = words.length;

  const imgs = $('img');
  audit.imageCount = imgs.length;
  audit.imagesWithAlt = imgs.filter((_, el) => Boolean($(el).attr('alt')?.trim())).length;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    try {
      const u = new URL(href, finalUrl);
      if (u.hostname.toLowerCase() === finalDomain) audit.internalLinks++;
      else audit.externalLinks++;
    } catch { /* skip */ }
  });

  audit.mobileViewport = Boolean($('meta[name="viewport"]').attr('content'));
  audit.ogTagCount = $('meta[property^="og:"]').length;
  audit.twitterCard = $('meta[name^="twitter:"]').length > 0;
  audit.jsonLd = $('script[type="application/ld+json"]').length > 0;

  audit.hasGoogleAnalytics = lower.includes('google-analytics.com') || lower.includes('gtag(') || lower.includes('analytics.js');
  audit.hasGoogleTagManager = lower.includes('googletagmanager.com');
  audit.hasFacebookPixel = lower.includes('connect.facebook.net') || lower.includes('fbq(');
  audit.hasHubSpot = lower.includes('hs-scripts') || lower.includes('hubspot.com');

  audit.tech = detectTech(lower, $);

  const bodyText = $.root().text();
  const emailMatches = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  audit.emails = [...new Set(emailMatches.map(e => e.toLowerCase()))]
    .filter(e => !NOISE_EMAILS.some(n => e.includes(n)))
    .slice(0, 5);

  const phoneMatches = bodyText.match(/\+?\d[\d\s().-]{6,}\d/g) || [];
  audit.phones = [...new Set(
    phoneMatches.map(p => p.trim()).filter(p => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15;
    }),
  )].slice(0, 3);

  audit.socials = extractSocials(html);

  return audit;
}

// ============ ROBUST AUDIT (puppeteer + axios fallback) ============

async function checkRobotsAndSitemap(audit: WebsiteAudit, finalUrl: string) {
  try {
    const origin = new URL(finalUrl).origin;
    const cfg = { timeout: 5000, validateStatus: () => true, headers: { 'User-Agent': UA } };
    const [robots, sitemap] = await Promise.allSettled([
      axios.get(`${origin}/robots.txt`, cfg),
      axios.get(`${origin}/sitemap.xml`, cfg),
    ]);
    const ok = (r: PromiseSettledResult<{ status: number }>) =>
      r.status === 'fulfilled' && r.value.status >= 200 && r.value.status < 400;
    audit.hasRobotsTxt = ok(robots);
    audit.hasSitemap = ok(sitemap);
  } catch { /* skip */ }
}

interface AuditOutcome {
  status: WebsiteStatus;        // 'audited' | 'unreachable'
  audit: WebsiteAudit;
  failReason: string | null;
}

/** Audit the website using the existing Puppeteer browser. Renders JS, follows redirects. */
async function auditWebsiteWithPuppeteer(browser: Browser, websiteUrl: string): Promise<AuditOutcome> {
  const page = await browser.newPage();
  let failReason: string | null = null;
  try {
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    const start = Date.now();
    let response;
    try {
      response = await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Navigation failed';
      failReason = msg.includes('timeout') ? 'Site took too long to load' :
                   msg.includes('ERR_NAME_NOT_RESOLVED') ? 'Domain does not resolve' :
                   msg.includes('ERR_CERT') ? 'SSL certificate problem' :
                   msg.includes('ERR_CONNECTION') ? 'Connection refused' :
                   'Could not reach the site';
      return { status: 'unreachable', audit: { ...buildEmptyAudit(websiteUrl), loadTimeMs: Date.now() - start }, failReason };
    }

    const loadTimeMs = Date.now() - start;
    const httpStatus = response?.status() ?? 0;
    const finalUrl = page.url();

    if (!response || httpStatus >= 400) {
      failReason = httpStatus === 403 ? 'Site blocked our request (403)' :
                   httpStatus === 429 ? 'Site rate-limited us (429)' :
                   httpStatus >= 500 ? `Site returned ${httpStatus}` :
                   httpStatus > 0 ? `Site returned ${httpStatus}` : 'No response';
      const audit = buildEmptyAudit(finalUrl);
      audit.httpStatus = httpStatus;
      audit.loadTimeMs = loadTimeMs;
      audit.httpsActive = finalUrl.startsWith('https://');
      audit.redirected = finalUrl !== websiteUrl;
      return { status: 'unreachable', audit, failReason };
    }

    // Give JS-heavy sites a moment to render text/socials
    await delay(400, 800);
    const html = await page.content();

    const audit = analyzeHtml(html, finalUrl);
    audit.httpStatus = httpStatus;
    audit.loadTimeMs = loadTimeMs;
    audit.redirected = finalUrl !== websiteUrl;

    await checkRobotsAndSitemap(audit, finalUrl);

    return { status: 'audited', audit, failReason: null };
  } catch (err) {
    failReason = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'unreachable', audit: buildEmptyAudit(websiteUrl), failReason };
  } finally {
    await page.close().catch(() => {});
  }
}

// ============ SEO SCORE ============

export function computeSeoScore(a: WebsiteAudit): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  const add = (label: string, weight: number, ok: boolean, value?: string) =>
    factors.push({ label, weight, awarded: ok ? weight : 0, ok, value });

  add('HTTPS enabled', 8, a.httpsActive);
  add('Page reachable', 6, a.reachable, `${a.httpStatus || '—'}`);
  add('Title tag (10–65 chars)', 10, a.titleLength >= 10 && a.titleLength <= 65, `${a.titleLength} chars`);
  add('Meta description (50–160)', 10, a.metaDescriptionLength >= 50 && a.metaDescriptionLength <= 160, `${a.metaDescriptionLength} chars`);
  add('Single H1', 6, a.h1Count === 1, `${a.h1Count}`);
  add('Mobile viewport', 12, a.mobileViewport);
  add('Open Graph tags (≥3)', 5, a.ogTagCount >= 3, `${a.ogTagCount}`);
  add('Schema.org JSON-LD', 5, a.jsonLd);
  add('Canonical URL', 5, Boolean(a.canonical));
  add('Sitemap.xml present', 5, a.hasSitemap);
  add('Robots.txt present', 3, a.hasRobotsTxt);

  const altRatio = a.imageCount > 0 ? a.imagesWithAlt / a.imageCount : 0;
  add('Image alt text (≥80%)', 5, a.imageCount > 0 && altRatio >= 0.8, a.imageCount === 0 ? 'no images' : `${Math.round(altRatio * 100)}%`);

  add('Substantial content (>300 words)', 6, a.wordCount > 300, `${a.wordCount} words`);
  const fast = a.loadTimeMs > 0 && a.loadTimeMs < 3000;
  add('Page speed (<3s)', 8, fast, a.loadTimeMs > 0 ? `${(a.loadTimeMs / 1000).toFixed(2)}s` : '—');
  add('Analytics installed', 4, a.hasGoogleAnalytics || a.hasGoogleTagManager);
  add('Social presence linked', 2, Object.values(a.socials).some(Boolean));

  const score = factors.reduce((acc, f) => acc + f.awarded, 0);
  return { score, factors };
}

// ============ TOP-LEVEL FLOW ============

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function discoverTargets(
  browser: Browser,
  niche: string,
  location: string,
  scanLimit: number,
): Promise<MapsTarget[]> {
  const placeLinks = await discoverPlaceLinks(browser, niche, location, scanLimit);
  const targets: MapsTarget[] = [];
  for (const link of placeLinks) {
    const t = await extractMapsTarget(browser, link);
    if (t) targets.push(t);
  }
  return targets;
}

export async function buildLeadFromTarget(browser: Browser, target: MapsTarget): Promise<Lead> {
  let websiteStatus: WebsiteStatus = 'none';
  let websiteFailReason: string | null = null;
  let audit: WebsiteAudit | undefined;
  let factors: ScoreFactor[] = [];
  let score = 0;
  let mainEmail = 'No email found';
  let primaryTech = 'Unknown';

  if (target.website) {
    const outcome = await auditWebsiteWithPuppeteer(browser, target.website);
    websiteStatus = outcome.status;
    websiteFailReason = outcome.failReason;
    audit = outcome.audit;

    if (outcome.status === 'audited') {
      const result = computeSeoScore(audit);
      score = result.score;
      factors = result.factors;

      if (audit.emails.length > 0) {
        const ranked = [...audit.emails].sort((a, b) => {
          const ap = /(contact|hello|info|sales|admin|office)@/i.test(a) ? 0 : 1;
          const bp = /(contact|hello|info|sales|admin|office)@/i.test(b) ? 0 : 1;
          return ap - bp;
        });
        mainEmail = ranked[0];
      }
      primaryTech = audit.tech[0] || 'Custom';
    }
  }

  const riskLevel: Lead['stats']['riskLevel'] =
    websiteStatus === 'none'         ? 'Critical' :
    websiteStatus === 'unreachable'  ? 'High Risk' :
    score < 35                       ? 'Critical' :
    score < 60                       ? 'High Risk' :
    score < 80                       ? 'Medium' : 'Low';

  const finalUrl =
    websiteStatus === 'audited' ? (audit?.finalUrl ?? target.website ?? 'No website detected') :
    websiteStatus === 'unreachable' ? (target.website ?? 'No website detected') :
    'No website detected';

  const isSocialOnly = audit?.isSocialOnly ?? false;

  return {
    id: Math.random().toString(36).slice(2, 11),
    name: target.name,
    url: finalUrl,
    websiteFromMaps: target.website,
    websiteStatus,
    websiteFailReason,
    email: mainEmail,
    tech: primaryTech,
    rating: target.rating,
    reviews: target.reviews,
    address: target.address,
    phone: target.phone,
    mapsUrl: target.mapsUrl,
    isSocialUrl: isSocialOnly,
    authorityScore: target.authorityScore,
    stats: { score, riskLevel },
    scoreFactors: factors,
    audit,
    pitch: buildPitch(target.name, websiteStatus, primaryTech, factors, websiteFailReason),
    lastAuditedAt: new Date().toISOString(),
  };
}

/** Re-audit a single existing lead by going back to its Maps page. Used by the re-audit endpoint. */
export async function reauditLead(existing: Lead): Promise<Lead> {
  return await withBrowser(async (browser) => {
    const target = await extractMapsTarget(browser, existing.mapsUrl);
    if (!target) {
      // We can't even get the Maps page back — leave existing data, just stamp the timestamp
      return { ...existing, lastAuditedAt: new Date().toISOString() };
    }
    const fresh = await buildLeadFromTarget(browser, target);
    // Preserve user data
    return {
      ...fresh,
      id: existing.id,
      status: existing.status,
      notes: existing.notes,
      date: existing.date,
    };
  });
}

function buildPitch(
  name: string,
  status: WebsiteStatus,
  tech: string,
  factors: ScoreFactor[],
  failReason: string | null,
): string {
  if (status === 'none') {
    return `Hi ${name} — I noticed you don't have a website that's discoverable from Google Maps. A simple landing page can capture searches that currently slip through to competitors.`;
  }
  if (status === 'unreachable') {
    return `Hi ${name} — I tried to audit your site but couldn't reach it (${failReason ?? 'unknown reason'}). If your site has been intermittent, that alone is hurting search rankings. Happy to take a closer look if useful.`;
  }
  const failures = factors.filter(f => !f.ok).map(f => f.label.toLowerCase());
  const top = failures.slice(0, 2);
  const lead = top.length
    ? `I ran a quick audit on your site and found a few quick wins — ${top.join(' and ')}.`
    : `I ran a quick audit on your site and it's solid — there's still room to push it further.`;
  return `Hi ${name} — ${lead} Happy to share the full breakdown if useful. (Stack: ${tech}.)`;
}
