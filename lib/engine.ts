import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';
import {
  Lead, WebsiteAudit, ScoreFactor, Socials, WebsiteStatus, Opportunity,
  PresenceDimensions, DimensionBreakdown, OPPORTUNITY_META, DeepReport, SocialCheck,
} from './types';
import { BALI_AREAS } from './bali';

/** First known Bali area mentioned in an address (used to sharpen social searches). */
function baliAreaOf(address: string): string {
  const a = (address || '').toLowerCase();
  return BALI_AREAS.find((area) => a.includes(area.toLowerCase())) ?? '';
}

// ==========================================================================
// Engine v3 — accuracy-focused
// ==========================================================================
// Key tactics:
//   - Maps page: wait for actions row to fully hydrate (networkidle2 + race),
//     then try 7+ selectors before falling back to a ranked-link scan.
//   - Audit: stealth setup (webdriver/plugins/lang/permissions/client hints),
//     try multiple URL variants (www toggle, https toggle, tracking stripped),
//     fall back to axios with realistic headers if puppeteer can't navigate.
//   - Every attempt is logged into Lead.auditAttempts so you can see *why*
//     a particular lead was flagged the way it was.
// ==========================================================================

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Instagram (and TikTok) only serve their public og:description stats to a
// mobile user-agent; the desktop UA gets an empty JS shell.
const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const SOCIAL_DOMAINS = [
  'instagram.com', 'facebook.com', 'linktr.ee', 'tiktok.com',
  'linkedin.com', 'twitter.com', 'x.com', 'youtube.com',
];

const NOISE_EMAILS = [
  'example.', 'your.email', 'sentry.io', 'wixpress', 'jpg', 'png', 'gif', 'svg',
  '@2x', '@3x', 'sentry-next', 'sentry@',
];

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', '_ga', 'yclid',
];

const delay = (min: number, max: number) =>
  new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

// ===========================================================================
// STEALTH: bypass basic bot detection (Cloudflare, Wix, Squarespace, etc.)
// ===========================================================================

async function setupStealth(page: Page) {
  await page.evaluateOnNewDocument(() => {
    // Hide that we're automated
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Realistic plugins (Chrome detection often checks plugins.length > 0)
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    // Permissions API mock — many bot detectors probe Notification.permission
    const origQuery = window.navigator.permissions?.query;
    if (origQuery) {
      window.navigator.permissions.query = (params: PermissionDescriptor) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: 'default' as PermissionState, name: params.name } as PermissionStatus)
          : origQuery.call(window.navigator.permissions, params);
    }
    // WebGL vendor — detectors check this
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });

  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Sec-Ch-Ua': '"Chromium";v="122", "Google Chrome";v="122", "Not A;Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  });
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
}

// ===========================================================================
// MAPS DISCOVERY
// ===========================================================================

interface MapsTarget {
  name: string;
  rating: number;
  reviews: string;
  reviewCount: number;
  website: string | null;
  rawWebsite: string | null;
  address: string;
  phone: string;
  mapsUrl: string;
  authorityScore: number;
  socials: Socials;        // any social links exposed on the Maps listing itself
  extractionNotes: string[];
}

const EMPTY_SOCIALS = (): Socials => ({
  instagram: null, facebook: null, linkedin: null, twitter: null, tiktok: null, youtube: null,
});

function unwrapGoogleRedirect(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname.endsWith('google.com') && (u.pathname === '/url' || u.pathname === '/aclk' || u.pathname === '/maps/redirect')) {
      const q = u.searchParams.get('q') || u.searchParams.get('url') || u.searchParams.get('adurl');
      if (q && /^https?:\/\//i.test(q)) return q;
    }
  } catch { /* not a URL */ }
  return href;
}

function isMapsInternalUrl(href: string): boolean {
  return /(^https?:\/\/)?(www\.)?(google\.[a-z.]+|gstatic\.com|googleapis\.com|googleusercontent\.com|googlemaps\.com|goo\.gl)/i.test(href);
}

function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    return u.toString();
  } catch { return url; }
}

function urlVariants(url: string): string[] {
  const out = new Set<string>();
  out.add(url);
  out.add(stripTrackingParams(url));
  try {
    const u = new URL(stripTrackingParams(url));
    if (u.hostname.startsWith('www.')) {
      const noWww = new URL(u.toString());
      noWww.hostname = u.hostname.slice(4);
      out.add(noWww.toString());
    } else {
      const withWww = new URL(u.toString());
      withWww.hostname = 'www.' + u.hostname;
      out.add(withWww.toString());
    }
    if (u.protocol === 'http:') {
      const https = new URL(u.toString());
      https.protocol = 'https:';
      out.add(https.toString());
    }
  } catch { /* skip */ }
  return [...out];
}

async function dismissConsent(page: Page) {
  try {
    await delay(800, 1400);
    const buttons = await page.$$('button');
    for (const button of buttons) {
      const text = await page.evaluate((el) => (el as HTMLElement).innerText, button);
      if (/accept all|i agree|^agree|accepter/i.test(text)) {
        await button.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
        break;
      }
    }
  } catch { /* ignore */ }
}

export async function discoverPlaceLinks(browser: Browser, niche: string, location: string, scanLimit: number): Promise<string[]> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    const query = encodeURIComponent(`${niche} in ${location}`);
    const searchUrl = `https://www.google.com/maps/search/${query}?hl=en`;
    // domcontentloaded + an explicit waitForSelector below is far faster and more
    // reliable than networkidle2 on Maps, which has constant background traffic.
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissConsent(page);

    await page.waitForSelector('div[role="feed"], [aria-label*="Results for"]', { timeout: 20000 });

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
    await page.close().catch(() => {});
  }
}

/**
 * Multi-strategy Maps extraction. Waits for the actions row (which contains
 * the website button) to actually mount, then tries 7+ specific selectors
 * before falling back to a ranked link scan. Always returns extractionNotes
 * so you can see what we found and didn't.
 */
export async function extractMapsTarget(browser: Browser, link: string): Promise<MapsTarget | null> {
  const page = await browser.newPage();
  const notes: string[] = [];
  try {
    await page.setUserAgent(UA);
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait for ANY indicator that the place panel is hydrated. Race so we
    // don't wait the full timeout on places that hydrate fast.
    try {
      await Promise.race([
        page.waitForSelector('a[data-item-id="authority"]', { timeout: 8000 }),
        page.waitForSelector('button[data-item-id="address"]', { timeout: 8000 }),
        page.waitForSelector('button[data-item-id*="phone"]', { timeout: 8000 }),
        page.waitForSelector('h1.DUwDvf', { timeout: 8000 }),
      ]);
    } catch { notes.push('panel-hydration-timeout'); }

    // Brief settle for trailing async DOM (the selector race above already
    // confirms the panel is mounted, so this just needs to be short).
    await delay(400, 700);

    const details = await page.evaluate(() => {
      const getText = (el: Element | null) => (el as HTMLElement | null)?.innerText || '';

      // ----- Name -----
      const name = getText(document.querySelector('h1.DUwDvf, h1')) || 'Unknown Business';

      // ----- Rating / reviews -----
      const ratingStr = document.querySelector('span[role="img"][aria-label*="stars"]')
        ?.getAttribute('aria-label')?.split(' ')[0];
      const rating = parseFloat(ratingStr || '0');
      // Review count can live in aria-label or inner text of several elements.
      const reviewEl = document.querySelector(
        'button[aria-label*="reviews" i], button[jsaction*="reviewChart"], span[aria-label*="reviews" i], [aria-label*="reviews" i]',
      );
      const reviewsRaw = (reviewEl?.getAttribute('aria-label') || (reviewEl as HTMLElement | null)?.innerText || '').trim();
      // Pull the number that precedes "review(s)" so we don't also grab the rating
      // digits (e.g. "4.8 stars 1,616 reviews" must read 1616, not 481616).
      const reviewMatch = reviewsRaw.match(/([\d.,]+)\s*reviews?/i);
      const reviewCount = parseInt((reviewMatch ? reviewMatch[1] : reviewsRaw).replace(/[^\d]/g, ''), 10) || 0;
      const reviews = reviewsRaw || (reviewCount ? `${reviewCount} reviews` : '0');

      // ----- Website extraction (multi-strategy) -----
      const usedNotes: string[] = [];
      let website: string | null = null;
      let raw: string | null = null;

      // Strategy 1: explicit selectors (most reliable when present)
      const selectors = [
        'a[data-item-id="authority"]',
        'a[data-item-id^="authority"]',
        'a[jsaction*="placeWebsiteLink"]',
        'a[jsaction*="placeMenuLink"]',
        'a[data-tooltip="Open website"]',
        'a[data-tooltip*="ebsite"]',
        'a[aria-label="Website"]',
        'a[aria-label^="Website:"]',
        'a[aria-label*="ebsite"]',
        'a[data-value="Website"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLAnchorElement | null;
        if (el?.href) {
          website = el.href; raw = el.getAttribute('href');
          usedNotes.push(`selector:${sel}`);
          break;
        }
      }

      // Strategy 2: any anchor whose visible text equals the domain pattern
      if (!website) {
        const anchors = Array.from(document.querySelectorAll('a[href^="http"]')) as HTMLAnchorElement[];
        for (const a of anchors) {
          const txt = (a.innerText || '').trim();
          // looks like a domain name visible inside the anchor (e.g. "realsite.com")
          if (/^[a-z0-9][a-z0-9-]+\.[a-z]{2,}(\.[a-z]{2,})?\/?$/i.test(txt)) {
            const href = a.href;
            // Quick filter: skip Google/social/maps internal
            if (!/google\.[a-z.]+|gstatic|googleusercontent|googlemaps|googleapis/i.test(href)) {
              website = href; raw = a.getAttribute('href');
              usedNotes.push(`domain-text-match:${txt}`);
              break;
            }
          }
        }
      }

      // Strategy 3: ranked link scan in side panel
      if (!website) {
        const main = document.querySelector('div[role="main"]') ||
                     document.querySelector('div.m6QErb') ||
                     document.body;
        const anchors = Array.from(main.querySelectorAll('a[href^="http"]')) as HTMLAnchorElement[];
        const scored = anchors
          .filter(a => {
            const h = a.href.toLowerCase();
            if (/google\.[a-z.]+|gstatic|googleusercontent|googlemaps|googleapis|goo\.gl/i.test(h)) return false;
            if (/(instagram|facebook|tiktok|linkedin|youtube|twitter|x)\.com\//.test(h)) return false;
            // exclude directions/share links
            if (h.includes('/maps/dir/') || h.includes('/maps/place/')) return false;
            return true;
          })
          .map(a => {
            // higher score = more likely the website
            let score = 0;
            const aria = (a.getAttribute('aria-label') || '').toLowerCase();
            const dt = (a.getAttribute('data-tooltip') || '').toLowerCase();
            if (aria.includes('website')) score += 10;
            if (dt.includes('website')) score += 10;
            if (a.querySelector('img[alt*="ebsite"]')) score += 8;
            if (a.getAttribute('data-item-id')?.startsWith('authority')) score += 15;
            // anchors inside the actions row are top candidates
            if (a.closest('[role="button"], button')) score += 3;
            return { a, score };
          })
          .sort((x, y) => y.score - x.score);

        if (scored.length > 0 && scored[0].score > 0) {
          website = scored[0].a.href;
          raw = scored[0].a.getAttribute('href');
          usedNotes.push(`ranked-scan:score=${scored[0].score}`);
        } else if (scored.length === 1) {
          // only one external link in panel — likely the website
          website = scored[0].a.href;
          raw = scored[0].a.getAttribute('href');
          usedNotes.push(`single-external-link`);
        }
      }

      const address = document.querySelector('button[data-item-id="address"]')
        ?.getAttribute('aria-label')?.replace(/^Address:\s*/i, '') || '';
      const phone = document.querySelector('button[data-item-id*="phone"]')
        ?.getAttribute('aria-label')?.replace(/^Phone:\s*/i, '') || '';

      // ----- Social links shown on the listing (free to grab while we're here) -----
      const socialHrefs = (Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[])
        .map((a) => a.href)
        .filter((h) => /(instagram|facebook|tiktok|linkedin|youtube|twitter|x)\.com\//i.test(h));

      return { name, rating, reviews, reviewCount, website, raw, address, phone, socialHrefs, usedNotes };
    });

    notes.push(...details.usedNotes);

    let website = details.website;
    if (website) {
      const before = website;
      website = unwrapGoogleRedirect(website);
      if (before !== website) notes.push('unwrapped-redirect');
      if (isMapsInternalUrl(website)) {
        notes.push(`rejected-internal:${website.slice(0, 60)}`);
        website = null;
      }
    } else {
      notes.push('no-website-found');
    }

    const socials = socialsFromUrls(details.socialHrefs || []);
    if (countSocials(socials) > 0) notes.push(`maps-socials:${countSocials(socials)}`);

    return {
      name: details.name,
      rating: details.rating,
      reviews: details.reviews,
      reviewCount: details.reviewCount || 0,
      website,
      rawWebsite: details.raw,
      address: details.address || 'No Address',
      phone: details.phone || 'No Phone',
      mapsUrl: link,
      authorityScore: (details.rating || 0) * 10,
      socials,
      extractionNotes: notes,
    };
  } catch (err) {
    notes.push(`error:${err instanceof Error ? err.message.split('\n')[0] : 'unknown'}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// ===========================================================================
// HTML ANALYSIS (shared between fetch strategies)
// ===========================================================================

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

// ===========================================================================
// SOCIAL DISCOVERY — normalise links, count them, and (best-effort) search the
// open web for a business's profiles when we don't already know them.
// ===========================================================================

function countSocials(s: Socials): number {
  return Object.values(s).filter(Boolean).length;
}

/** Merge social objects; earlier sources win per platform (so website > maps > search). */
function mergeSocials(...sources: (Socials | undefined)[]): Socials {
  const out = EMPTY_SOCIALS();
  for (const src of sources) {
    if (!src) continue;
    (Object.keys(out) as (keyof Socials)[]).forEach((k) => { if (!out[k] && src[k]) out[k] = src[k]; });
  }
  return out;
}

// Path segments that are NOT a profile (platform features, not businesses).
const RESERVED_IG = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'about', 'directory', 'stories', 'tv', 'tags', 'locations', 'legal', 'developer', 'privacy', 'sitemap', 'web']);
const RESERVED_FB = new Set(['profile.php', 'pages', 'groups', 'events', 'watch', 'marketplace', 'sharer', 'tr', 'plugins', 'dialog', 'login', 'help', 'policies', 'business', 'ads', 'permalink.php', 'people', 'photo', 'story.php']);
const RESERVED_TW = new Set(['home', 'search', 'i', 'intent', 'share', 'hashtag', 'explore', 'messages', 'settings']);

/** Classify a single URL as a clean social PROFILE (platform + canonical url), or null. */
function classifyProfile(raw: string): { platform: keyof Socials; url: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (!seg.length) return null;
  const first = seg[0];
  const firstLc = first.toLowerCase();

  if (/(^|\.)instagram\.com$/.test(host)) {
    if (!RESERVED_IG.has(firstLc) && /^[a-z0-9._]{2,30}$/i.test(first)) return { platform: 'instagram', url: `https://instagram.com/${first}` };
  } else if (/(^|\.)facebook\.com$/.test(host)) {
    if (!RESERVED_FB.has(firstLc) && /^[a-z0-9.\-]{3,}$/i.test(first)) return { platform: 'facebook', url: `https://facebook.com/${first}` };
  } else if (/(^|\.)tiktok\.com$/.test(host)) {
    const handle = firstLc.startsWith('@') ? first : '@' + first;
    if (handle.length > 2 && /^@[a-z0-9._]{2,}$/i.test(handle)) return { platform: 'tiktok', url: `https://tiktok.com/${handle}` };
  } else if (/(^|\.)linkedin\.com$/.test(host)) {
    if ((firstLc === 'company' || firstLc === 'in') && seg[1]) return { platform: 'linkedin', url: `https://linkedin.com/${firstLc}/${seg[1]}` };
  } else if (/(^|\.)youtube\.com$/.test(host)) {
    if (firstLc.startsWith('@')) return { platform: 'youtube', url: `https://youtube.com/${first}` };
    if (['channel', 'user', 'c'].includes(firstLc) && seg[1]) return { platform: 'youtube', url: `https://youtube.com/${firstLc}/${seg[1]}` };
  } else if (/(^|\.)(twitter|x)\.com$/.test(host)) {
    if (!RESERVED_TW.has(firstLc) && /^[a-z0-9_]{2,15}$/i.test(first)) return { platform: 'twitter', url: `https://x.com/${first}` };
  }
  return null;
}

/** Turn raw URLs into a Socials object, keeping the first clean profile per platform. */
function socialsFromUrls(urls: string[]): Socials {
  const s = EMPTY_SOCIALS();
  for (const raw of urls) {
    const p = classifyProfile(raw);
    if (p && !s[p.platform]) s[p.platform] = p.url;
  }
  return s;
}

const normalizeStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Common, non-distinctive words that shouldn't be enough to match a business on their own.
const GENERIC_NAME_WORDS = new Set([
  'bali', 'ubud', 'canggu', 'seminyak', 'uluwatu', 'sanur', 'kuta', 'denpasar',
  'the', 'and', 'restaurant', 'cafe', 'coffee', 'warung', 'bar', 'club', 'beach',
  'hotel', 'villa', 'villas', 'resort', 'spa', 'shop', 'store', 'house', 'group',
  'studio', 'salon', 'clinic', 'kitchen', 'food', 'eatery', 'bistro', 'lounge',
]);

/**
 * How confidently a profile handle belongs to this business:
 *  - "strong": the handle is (or contains, or is contained by) the full name.
 *  - "weak":   it only shares a distinctive word (could be a different business).
 *  - null:     no plausible match.
 */
function matchStrength(url: string, name: string): 'strong' | 'weak' | null {
  let path = '';
  try { path = (new URL(url).pathname.split('/').filter(Boolean)[0] || '').replace(/^@/, ''); } catch { return null; }
  const h = normalizeStr(path);
  const n = normalizeStr(name);
  if (h.length < 3 || n.length < 3) return null;
  if (n.includes(h) || h.includes(n)) return 'strong';
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 5 && !GENERIC_NAME_WORDS.has(t));
  return tokens.some((t) => h.includes(t)) ? 'weak' : null;
}

/** Boolean form, kept for tests. */
function handleMatchesName(url: string, name: string): boolean {
  return matchStrength(url, name) !== null;
}

/**
 * Find a business's social profiles via web search. To keep keyed-API quotas
 * (e.g. Google CSE's 100/day) for when they're actually needed, the order is:
 *  1. FREE Brave HTML scrape (unlimited, just paced) — handles the bulk.
 *  2. Only when scraping is being throttled, spend a keyed API request as a
 *     buffer: Brave Search API, then Google Custom Search.
 *  3. Bing scrape as a last free attempt.
 * So the daily API quota is a reserve for burst moments, not used per lead.
 */
const SOCIAL_URL_RX = /https?:\/\/(?:[a-z0-9-]+\.)?(?:instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|youtube\.com|twitter\.com|x\.com)\/[^\s"'<>)\]&]+/gi;

// Space out scrape requests across a sweep so we don't trip rate limits.
let _lastSearchAt = 0;
async function paceSearch(minGapMs = 1300) {
  const wait = _lastSearchAt + minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _lastSearchAt = Date.now();
}

/** Official Brave Search API. Returns result URLs, or null when no key is configured. */
async function braveApiUrls(query: string): Promise<string[] | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  try {
    const r = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: { q: query, count: 10 },
      timeout: 8000,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': key },
      validateStatus: () => true,
    });
    if (r.status !== 200) return null;                 // quota/error -> let caller fall through
    const results = r.data?.web?.results;
    if (!Array.isArray(results)) return [];
    const out: string[] = [];
    for (const res of results as Array<{ url?: string }>) if (res.url) out.push(res.url);
    return out;
  } catch { return null; }
}

/**
 * Google Programmable Search (Custom Search JSON API). Free tier: 100 queries/day.
 * Uses your existing Google key plus a (free to create) search-engine id in GOOGLE_CSE_ID.
 * Returns result URLs, or null when not configured.
 */
async function googleCseUrls(query: string): Promise<string[] | null> {
  const key = process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;
  try {
    const r = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: { key, cx, q: query, num: 10 },
      timeout: 8000, validateStatus: () => true,
    });
    if (r.status !== 200) return null;                 // quota exhausted/error -> fall through
    if (!Array.isArray(r.data?.items)) return [];
    return (r.data.items as Array<{ link?: string }>).map((i) => i.link).filter((l): l is string => !!l);
  } catch { return null; }
}

async function scrapeSearch(engine: 'brave' | 'bing', query: string): Promise<{ urls: string[]; status: number }> {
  const base = engine === 'brave' ? 'https://search.brave.com/search' : 'https://www.bing.com/search';
  const res = await axios.get(base, {
    params: { q: query },
    timeout: 6000,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    validateStatus: () => true,
  });
  const body = typeof res.data === 'string' ? res.data : '';
  const urls = [...new Set((body.match(SOCIAL_URL_RX) || []).map((u) => u.replace(/&amp;/g, '&')))];
  return { urls, status: res.status };
}

// Circuit breaker: once a free-tier search engine starts throttling us, stop
// hammering it for a few minutes so a big sweep doesn't waste time on 429s.
let _searchCooldownUntil = 0;
let _consecThrottle = 0;

async function webSearch(query: string): Promise<string[]> {
  // 1) FREE Brave scrape first (unlimited), unless we're in a throttle cooldown.
  let throttled = Date.now() < _searchCooldownUntil;
  if (!throttled) {
    try {
      await paceSearch();
      const { urls, status } = await scrapeSearch('brave', query);
      if (status === 429 || status === 202) {
        throttled = true;
        if (++_consecThrottle >= 3) _searchCooldownUntil = Date.now() + 5 * 60_000;
      } else {
        _consecThrottle = 0;
        return urls; // a real answer (even empty) — don't spend API quota
      }
    } catch { throttled = true; }
  }

  // 2) Only when scraping is throttled: spend a keyed-API request as a buffer.
  if (throttled) {
    const brave = await braveApiUrls(query);
    if (brave !== null) return brave;
    const google = await googleCseUrls(query);
    if (google !== null) return google;
    // 3) No quota left either: one last free attempt via Bing.
    try {
      const { urls, status } = await scrapeSearch('bing', query);
      if (status === 200) return urls;
    } catch { /* ignore */ }
  }
  return [];
}

/**
 * Best-effort: search the open web for a business's social profiles when we
 * don't already know them. Time-boxed, fault-tolerant (never throws), and
 * validated against the business name so we don't attach the wrong account.
 * For recall, we pick the first profile per platform that MATCHES THE NAME,
 * not just the first profile on the page (which may be an ad or unrelated).
 */
async function findSocials(name: string, area: string, category?: string): Promise<Socials> {
  const found = EMPTY_SOCIALS();
  const bits = [name, category, area, 'Bali', 'instagram facebook'].filter(Boolean).join(' ');
  try {
    const urls = await webSearch(bits);
    const candidates = urls.map(classifyProfile).filter((c): c is { platform: keyof Socials; url: string } => !!c);
    (Object.keys(found) as (keyof Socials)[]).forEach((platform) => {
      const forPlatform = candidates.filter((c) => c.platform === platform);
      // Prefer a strong name match; only fall back to a weak one if there's no strong.
      const pick = forPlatform.find((c) => matchStrength(c.url, name) === 'strong')
        ?? forPlatform.find((c) => matchStrength(c.url, name) === 'weak');
      if (pick) found[platform] = pick.url;
    });
  } catch { /* best-effort, ignore */ }
  return found;
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
    adPixels: [],
    hasEmailCapture: false, hasBooking: false, hasLiveChat: false,
    hasBlog: false,
    tech: [],
    emails: [], phones: [],
    whatsapp: null,
    socials: { instagram: null, facebook: null, linkedin: null, twitter: null, tiktok: null, youtube: null },
    socialCount: 0,
    isSocialOnly: false,
  };
}

function extractWhatsApp(html: string): string | null {
  // wa.me/<digits>
  let m = html.match(/https?:\/\/(?:www\.)?wa\.me\/(\+?\d{6,15})/i);
  if (m) return m[1].replace(/^\+?/, '+');
  // api.whatsapp.com/send?phone=<digits>
  m = html.match(/https?:\/\/(?:api\.)?whatsapp\.com\/send\?[^"'\s]*phone=(\+?\d{6,15})/i);
  if (m) return m[1].replace(/^\+?/, '+');
  // wa.link
  m = html.match(/https?:\/\/wa\.link\/[A-Za-z0-9]+/i);
  if (m) return m[0];
  return null;
}

/** Pull a WhatsApp number out of free text (e.g. a social bio): wa.me links or a "WA: +62..." mention. */
function whatsappFromText(text: string): string | null {
  const link = text.match(/wa\.me\/(\+?\d{6,15})|whatsapp\.com\/send\?[^"'\s]*phone=(\+?\d{6,15})/i);
  if (link) return '+' + (link[1] || link[2]).replace(/^\+/, '');
  const mention = text.match(/(?:whats?app|wa)\b[^\d+]{0,8}(\+?\d[\d\s\-]{7,16}\d)/i);
  if (mention) { const d = mention[1].replace(/[^\d]/g, ''); if (d.length >= 9 && d.length <= 15) return '+' + d; }
  return null;
}

function isParkingPage(html: string, audit: WebsiteAudit): boolean {
  const lower = html.toLowerCase();
  const parkingPhrases = [
    'this domain is for sale',
    'this domain may be for sale',
    'this domain has been parked',
    'buy this domain',
    'domain is parked free',
    'is this your domain',
  ];
  if (audit.wordCount < 80 && parkingPhrases.some(p => lower.includes(p))) return true;
  return false;
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

  // ---- Marketing maturity: ad pixels ----
  const pixels = new Set<string>();
  if (audit.hasFacebookPixel) pixels.add('Meta Pixel');
  if (lower.includes('googleadservices') || lower.includes('google_conversion') || lower.includes('aw-')) pixels.add('Google Ads');
  if (lower.includes('analytics.tiktok.com') || lower.includes('ttq.')) pixels.add('TikTok Pixel');
  if (lower.includes('snap.licdn.com') || lower.includes('_linkedin_partner_id')) pixels.add('LinkedIn Insight');
  if (lower.includes('static.ads-twitter.com') || lower.includes('twq(')) pixels.add('X/Twitter Pixel');
  if (lower.includes('sc-static.net') || lower.includes('snaptr(')) pixels.add('Snap Pixel');
  audit.adPixels = [...pixels];

  // ---- Email / lead capture ----
  audit.hasEmailCapture =
    $('input[type="email"]').length > 0 ||
    $('form[action*="mailchimp" i], form[action*="klaviyo" i], form[action*="subscribe" i]').length > 0 ||
    /newsletter|subscribe|sign\s?up|join our list|get updates/i.test(lower);

  // ---- Online booking / ordering / reservation ----
  audit.hasBooking =
    /calendly\.com|opentable|resy\.com|booking\.com|hotjar|book now|book a table|reserve|reservation|order online|order now|buy tickets|appointment|schedule/i.test(lower) ||
    $('a[href*="calendly" i], a[href*="opentable" i], a[href*="resy" i], a[href*="booking" i], a[href*="book" i], a[href*="reserv" i], a[href*="order" i]').length > 0;

  // ---- Live chat widgets ----
  audit.hasLiveChat =
    /intercom|tawk\.to|crisp\.chat|drift\.com|zendesk|livechatinc|tidio|hubspot.*messages|wa\.me|api\.whatsapp/i.test(lower);

  // ---- Content: blog / news section ----
  audit.hasBlog =
    $('a[href*="/blog" i], a[href*="/news" i], a[href*="/articles" i], a[href*="/journal" i], a[href*="/stories" i]').length > 0 ||
    /\/blog|\/news|\/articles/i.test(lower);

  audit.tech = detectTech(lower, $);

  const bodyText = $.root().text();
  const emailMatches = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  // Guard against text-with-no-spaces concatenation (e.g. "...786whatsapp...@gmail.comopen"):
  // real emails have a short local part and a sane TLD.
  const isPlausibleEmail = (e: string) => {
    const at = e.split("@");
    if (at.length !== 2) return false;
    const [local, domain] = at;
    if (local.length < 1 || local.length > 30) return false;
    const labels = domain.split(".");
    if (labels.some((l) => l.length === 0)) return false;
    const tld = labels[labels.length - 1];
    return tld.length >= 2 && tld.length <= 8;
  };
  audit.emails = [...new Set(emailMatches.map(e => e.toLowerCase()))]
    .filter(e => isPlausibleEmail(e) && !NOISE_EMAILS.some(n => e.includes(n)))
    .slice(0, 5);

  // Phones: only trust explicit `tel:` links. Scraping phone-like strings out of
  // raw body text is hopelessly noisy — SVG path data ("20 20 160 160"), element
  // IDs, dates ("2024-06-07") and sizes all look like phones once formatted. The
  // Google listing already gives each lead a clean primary phone, so on-site phones
  // are a bonus and accuracy matters more than coverage here.
  const telLinks = $('a[href^="tel:"]')
    .map((_, el) => ($(el).attr('href') || '').replace(/^tel:/i, '').replace(/\s+/g, ' ').trim())
    .get();
  const validPhone = (p: string) => {
    const digits = p.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  };
  audit.phones = [...new Set(telLinks.filter(validPhone))].slice(0, 3);

  audit.socials = extractSocials(html);
  audit.socialCount = Object.values(audit.socials).filter(Boolean).length;
  audit.whatsapp = extractWhatsApp(html);

  return audit;
}

function detectOpportunities(o: {
  websiteStatus: WebsiteStatus;
  tech: string;
  audit?: WebsiteAudit;
  dimensions: PresenceDimensions;
  rating: number;
  reviewCount: number;
  isSocialOnly: boolean;
  socials?: Socials;
  socialInsights?: SocialCheck[];
}): Opportunity[] {
  const opps: Opportunity[] = [];
  const a = o.audit;
  const soc = o.socials ?? a?.socials;
  const sc = soc ? countSocials(soc) : 0;
  // a profile with barely any posts is effectively dormant
  const lowPostAccount = (o.socialInsights ?? []).some((s) => s.posts !== undefined && s.posts < 12);

  if (o.websiteStatus === "none") opps.push("needs_website");
  if (o.websiteStatus === "unreachable") opps.push("broken_website");
  if (o.isSocialOnly) opps.push("social_only");

  if (a && o.websiteStatus === "audited") {
    // website
    if (o.tech === "Wix" || o.tech === "Squarespace") opps.push("outdated_stack");
    if (!a.mobileViewport) opps.push("no_mobile");
    if (!a.httpsActive) opps.push("no_https");
    if (a.loadTimeMs > 5000) opps.push("slow_site");
    if (o.dimensions.site < 40) opps.push("weak_seo");
    if (a.wordCount < 200) opps.push("thin_content");
    // content
    if (!a.hasBlog && a.wordCount < 400) opps.push("no_content");
    // marketing — fire the broad pitch when weak, the specific one otherwise
    if (o.dimensions.marketing < 30) opps.push("no_marketing");
    else if (!a.hasGoogleAnalytics && !a.hasGoogleTagManager) opps.push("no_analytics");
    if (!a.hasEmailCapture) opps.push("no_email_capture");
    if (!a.hasBooking) opps.push("no_booking");
    if (a.emails.length === 0 && a.phones.length === 0 && !a.whatsapp) opps.push("no_contact_capture");
  }

  // social — judged from the best-known socials, with or without a website
  if (sc === 0) opps.push("no_social");
  else {
    if (!soc!.instagram) opps.push("no_instagram");
    if (sc === 1 || lowPostAccount) opps.push("dormant_social");
  }

  // discoverable on socials but no real website to convert on: they can be found,
  // but can't take bookings or be found on Google search.
  if (o.websiteStatus !== "audited" && !o.isSocialOnly && sc > 0) opps.push("no_booking");

  // reputation — available from the Maps listing even without a website
  if (o.reviewCount > 0 && o.reviewCount < 10) opps.push("low_reviews");
  if (o.rating > 0 && o.rating < 4.0) opps.push("weak_reputation");

  return opps;
}

// ===========================================================================
// ROBUST AUDIT
// ===========================================================================

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
  status: WebsiteStatus;
  audit: WebsiteAudit;
  failReason: string | null;
  attempts: string[];
  deepReport?: DeepReport;
}

async function tryPuppeteerAttempt(browser: Browser, url: string, attempts: string[]): Promise<{ ok: boolean; audit?: WebsiteAudit; reason: string }> {
  const page = await browser.newPage();
  try {
    await setupStealth(page);

    const start = Date.now();
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'navigation failed';
      const reason =
        /timeout/i.test(msg) ? 'timeout' :
        /ERR_NAME_NOT_RESOLVED/i.test(msg) ? 'DNS does not resolve' :
        /ERR_CERT/i.test(msg) ? 'SSL certificate problem' :
        /ERR_CONNECTION/i.test(msg) ? 'connection refused' :
        msg.split('\n')[0];
      attempts.push(`puppeteer ${url} → ${reason}`);
      return { ok: false, reason };
    }

    const httpStatus = response?.status() ?? 0;
    const finalUrl = page.url();
    if (finalUrl.startsWith('chrome-error://') || finalUrl === 'about:blank') {
      attempts.push(`puppeteer ${url} → chrome error page`);
      return { ok: false, reason: 'browser error page' };
    }
    if (!response || httpStatus >= 400) {
      const reason = httpStatus === 403 ? 'site blocked our request (403)'
                  : httpStatus === 429 ? 'site rate-limited us (429)'
                  : httpStatus >= 500 ? `server error (${httpStatus})`
                  : `HTTP ${httpStatus}`;
      attempts.push(`puppeteer ${url} → ${reason}`);
      return { ok: false, reason };
    }

    // Wait for content (JS-rendered SPAs)
    try {
      await page.waitForFunction(
        () => document.body && document.body.innerText.trim().length > 80,
        { timeout: 5000 },
      );
    } catch { /* maybe SPA never rendered, still try */ }

    const html = await page.content();
    const loadTimeMs = Date.now() - start;

    const audit = analyzeHtml(html, finalUrl);
    audit.httpStatus = httpStatus;
    audit.loadTimeMs = loadTimeMs;
    audit.redirected = finalUrl !== url;

    if (isParkingPage(html, audit)) {
      attempts.push(`puppeteer ${url} → parking page`);
      return { ok: false, reason: 'domain parked / for sale' };
    }
    if (audit.wordCount < 30 && audit.imageCount === 0) {
      attempts.push(`puppeteer ${url} → empty page (${audit.wordCount} words)`);
      return { ok: false, reason: 'page has no content' };
    }

    await checkRobotsAndSitemap(audit, finalUrl);
    attempts.push(`puppeteer ${url} → OK (${httpStatus}, ${audit.wordCount}w, ${(loadTimeMs/1000).toFixed(1)}s)`);
    return { ok: true, audit, reason: 'ok' };
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : 'unknown';
    attempts.push(`puppeteer ${url} → ${msg}`);
    return { ok: false, reason: msg };
  } finally {
    await page.close().catch(() => {});
  }
}

async function tryAxiosAttempt(url: string, attempts: string[]): Promise<{ ok: boolean; audit?: WebsiteAudit; reason: string }> {
  try {
    const start = Date.now();
    const response = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    const loadTimeMs = Date.now() - start;
    const finalUrl = response.request?.res?.responseUrl || url;

    if (response.status < 200 || response.status >= 400 || typeof response.data !== 'string' || response.data.length < 100) {
      attempts.push(`axios ${url} → HTTP ${response.status}`);
      return { ok: false, reason: `HTTP ${response.status}` };
    }

    const audit = analyzeHtml(response.data as string, finalUrl);
    audit.httpStatus = response.status;
    audit.loadTimeMs = loadTimeMs;
    audit.redirected = finalUrl !== url;

    if (isParkingPage(response.data as string, audit)) {
      attempts.push(`axios ${url} → parking page`);
      return { ok: false, reason: 'domain parked / for sale' };
    }

    await checkRobotsAndSitemap(audit, finalUrl);
    attempts.push(`axios ${url} → OK (${response.status}, ${audit.wordCount}w)`);
    return { ok: true, audit, reason: 'ok' };
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : 'unknown';
    attempts.push(`axios ${url} → ${msg}`);
    return { ok: false, reason: msg };
  }
}

/** Audit with multi-variant retry + axios fallback. Logs every attempt. */
async function auditWebsite(browser: Browser, websiteUrl: string): Promise<AuditOutcome> {
  const attempts: string[] = [];
  const variants = urlVariants(websiteUrl);
  let lastReason = 'unknown';

  // Phase 1: Puppeteer attempts on each variant
  for (const url of variants) {
    const r = await tryPuppeteerAttempt(browser, url, attempts);
    if (r.ok && r.audit) {
      return { status: 'audited', audit: r.audit, failReason: null, attempts };
    }
    lastReason = r.reason;
  }

  // Phase 2: Axios fallback on each variant
  for (const url of variants) {
    const r = await tryAxiosAttempt(url, attempts);
    if (r.ok && r.audit) {
      return { status: 'audited', audit: r.audit, failReason: null, attempts };
    }
    lastReason = r.reason;
  }

  // Truly unreachable
  const audit = buildEmptyAudit(websiteUrl);
  audit.httpsActive = websiteUrl.startsWith('https://');
  return { status: 'unreachable', audit, failReason: lastReason, attempts };
}

// ===========================================================================
// DEEP AUDIT — crawl key internal pages to find more contacts, socials, signals
// ===========================================================================

/** Fold a sub-page's findings into the homepage audit (fill gaps, OR booleans). */
function mergeAudit(base: WebsiteAudit, sub: WebsiteAudit) {
  (Object.keys(base.socials) as Array<keyof Socials>).forEach((k) => {
    if (!base.socials[k] && sub.socials[k]) base.socials[k] = sub.socials[k];
  });
  base.emails = [...new Set([...base.emails, ...sub.emails])].slice(0, 8);
  base.phones = [...new Set([...base.phones, ...sub.phones])].slice(0, 5);
  if (!base.whatsapp && sub.whatsapp) base.whatsapp = sub.whatsapp;
  base.hasBlog = base.hasBlog || sub.hasBlog;
  base.hasEmailCapture = base.hasEmailCapture || sub.hasEmailCapture;
  base.hasBooking = base.hasBooking || sub.hasBooking;
  base.hasLiveChat = base.hasLiveChat || sub.hasLiveChat;
  base.hasGoogleAnalytics = base.hasGoogleAnalytics || sub.hasGoogleAnalytics;
  base.hasGoogleTagManager = base.hasGoogleTagManager || sub.hasGoogleTagManager;
  base.hasFacebookPixel = base.hasFacebookPixel || sub.hasFacebookPixel;
  base.hasHubSpot = base.hasHubSpot || sub.hasHubSpot;
  base.jsonLd = base.jsonLd || sub.jsonLd;
  base.adPixels = [...new Set([...base.adPixels, ...sub.adPixels])];
  base.tech = [...new Set([...base.tech, ...sub.tech])];
  // a content-rich subpage demonstrates they do have substantial content
  base.wordCount = Math.max(base.wordCount, sub.wordCount);
  base.imageCount = Math.max(base.imageCount, sub.imageCount);
  base.h2Count = Math.max(base.h2Count, sub.h2Count);
}

/**
 * Audit the homepage robustly, then crawl up to 4 key internal pages
 * (about / contact / services / booking / blog) and merge what they reveal —
 * surfacing extra emails, phone numbers, social links, booking + content signals
 * that often live off the homepage.
 */
const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn',
  twitter: 'Twitter / X', tiktok: 'TikTok', youtube: 'YouTube',
};

/** Decode HTML entities + JSON unicode escapes that show up in og/meta strings. */
function decodeText(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, ' ').replace(/\\\//g, '/')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

/** "211K" -> 211000, "2,460" -> 2460, "2.4M" -> 2400000. */
function parseHumanCount(s: string): number | undefined {
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*([KMkm])?/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return undefined;
  const suf = (m[2] || '').toLowerCase();
  return Math.round(suf === 'k' ? n * 1e3 : suf === 'm' ? n * 1e6 : n);
}

const ogContent = (html: string, prop: string): string | null => {
  const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, 'i'));
  return m ? m[1] : null;
};

async function fetchText(url: string, ua: string, timeout = 9000) {
  const r = await axios.get(url, {
    timeout, maxRedirects: 5,
    headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' },
    validateStatus: () => true, responseType: 'text', transformResponse: [(d) => d],
  });
  return { status: r.status, finalUrl: (r.request?.res?.responseUrl as string) || url, html: typeof r.data === 'string' ? r.data : '' };
}

const handleFromUrl = (url: string): string | undefined => {
  try { const seg = new URL(url).pathname.split('/').filter(Boolean)[0]; return seg ? '@' + seg.replace(/^@/, '') : undefined; } catch { return undefined; }
};

/** Instagram public profile stats (mobile UA exposes og:description + JSON). */
async function enrichInstagram(url: string): Promise<SocialCheck> {
  const base: SocialCheck = { platform: 'Instagram', url, live: false, title: null, note: '', handle: handleFromUrl(url) };
  try {
    const { status, html } = await fetchText(url, UA_MOBILE);
    base.live = status >= 200 && status < 400;
    if (!base.live || !html) { base.note = `HTTP ${status}`; return base; }
    const desc = ogContent(html, 'description');
    if (desc) {
      const m = decodeText(desc).match(/([\d.,]+\s*[KMkm]?)\s+Followers,\s*([\d.,]+\s*[KMkm]?)\s+Following,\s*([\d.,]+\s*[KMkm]?)\s+Posts/i);
      if (m) { base.followers = parseHumanCount(m[1]); base.following = parseHumanCount(m[2]); base.posts = parseHumanCount(m[3]); }
    }
    // exact follower count from embedded JSON beats the rounded "211K"
    const exact = html.match(/"(?:edge_followed_by":\{"count"|follower_count)":?(\d+)/) || html.match(/"follower_count":(\d+)/);
    if (exact) base.followers = parseInt(exact[1], 10);
    const og = ogContent(html, 'title');
    if (og) { const nm = decodeText(og).match(/^(.*?)\s*\(@/); base.title = nm ? nm[1] : decodeText(og).slice(0, 80); }
    if (/"is_verified":true/.test(html)) base.verified = true;
    const bio = html.match(/"biography":"((?:[^"\\]|\\.){0,300})"/);
    if (bio && bio[1]) base.bio = decodeText(bio[1]).slice(0, 200);
    // Public contact email: IG business profiles often expose one; else scan the bio.
    const pe = html.match(/"(?:public_email|business_email)":"([^"@]+@[^"]+)"/);
    const emailCand = pe ? decodeText(pe[1]) : (base.bio?.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]);
    if (emailCand && !NOISE_EMAILS.some((n) => emailCand.toLowerCase().includes(n))) base.email = emailCand;
    if (base.followers === undefined && /log in|sign up/i.test(html.slice(0, 4000))) base.note = 'public data limited';
    return base;
  } catch { base.note = 'unreachable'; return base; }
}

/** TikTok public profile stats (followerCount lives in an embedded JSON blob). */
async function enrichTikTok(url: string): Promise<SocialCheck> {
  const base: SocialCheck = { platform: 'TikTok', url, live: false, title: null, note: '', handle: handleFromUrl(url) };
  try {
    const { status, html } = await fetchText(url, UA_MOBILE);
    base.live = status >= 200 && status < 400;
    if (!base.live || !html) { base.note = `HTTP ${status}`; return base; }
    const f = html.match(/"followerCount":(\d+)/); if (f) base.followers = parseInt(f[1], 10);
    const g = html.match(/"followingCount":(\d+)/); if (g) base.following = parseInt(g[1], 10);
    const v = html.match(/"videoCount":(\d+)/); if (v) base.posts = parseInt(v[1], 10);
    const nick = html.match(/"nickname":"((?:[^"\\]|\\.){0,80})"/); if (nick) base.title = decodeText(nick[1]);
    const sig = html.match(/"signature":"((?:[^"\\]|\\.){0,200})"/); if (sig && sig[1]) base.bio = decodeText(sig[1]).slice(0, 200);
    if (/"verified":true/.test(html)) base.verified = true;
    if (base.followers === undefined) base.note = 'public data limited';
    return base;
  } catch { base.note = 'unreachable'; return base; }
}

/** Liveness + whatever public meta renders, for platforms that gate the rest (FB, LinkedIn, X, YouTube). */
async function enrichGeneric(platform: string, url: string): Promise<SocialCheck> {
  const base: SocialCheck = { platform, url, live: false, title: null, note: '', handle: handleFromUrl(url) };
  try {
    const { status, finalUrl, html } = await fetchText(url, UA);
    // Facebook (and similar) bounce logged-out visitors to /login, often with a
    // 400. The page still exists, so treat it as present-but-gated, not dead.
    const gated = /\/login(\.php)?(\/|\?|$)/i.test(finalUrl)
      || /log in to facebook|see posts, photos/i.test(html.slice(0, 4000))
      || (/facebook\.com/i.test(url) && status === 400);
    if (gated) {
      base.live = true;
      base.note = 'present, public data gated (login wall)';
      return base;
    }
    base.live = status >= 200 && status < 400;
    if (base.live && html) {
      const t = ogContent(html, 'title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];
      base.title = t ? decodeText(t).slice(0, 120) : null;
    } else if (!base.live) {
      base.note = `HTTP ${status}`;
    }
    return base;
  } catch { base.note = 'unreachable'; return base; }
}

/** Enrich every known social account in parallel: real stats where we can, honest notes where we can't. */
async function enrichSocials(socials: Socials): Promise<SocialCheck[]> {
  const entries = (Object.entries(socials) as [string, string | null][]).filter(([, u]) => !!u) as [string, string][];
  return Promise.all(entries.map(([key, url]) => {
    if (key === 'instagram') return enrichInstagram(url);
    if (key === 'tiktok') return enrichTikTok(url);
    return enrichGeneric(PLATFORM_LABEL[key] || key, url);
  }));
}

/** Crawl the site (sitemap + nav), merge contact/social signals into the audit,
 *  and build a dossier: SEO health, broken links, freshness, page weight. */
async function buildDeepReport(origin: string, audit: WebsiteAudit, navLinks: string[]): Promise<DeepReport> {
  let sitemapFound = false;
  let sitemapUrls: string[] = [];
  try {
    const r = await axios.get(`${origin}/sitemap.xml`, {
      timeout: 8000, headers: { 'User-Agent': UA }, maxRedirects: 4,
      validateStatus: () => true, responseType: 'text', transformResponse: [(d) => d],
    });
    if (r.status >= 200 && r.status < 400 && typeof r.data === 'string' && /<loc>/i.test(r.data)) {
      sitemapFound = true;
      sitemapUrls = [...(r.data as string).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).filter((u) => u.startsWith(origin));
    }
  } catch { /* no sitemap */ }

  const candidates = [...new Set([audit.finalUrl, ...sitemapUrls, ...navLinks])].slice(0, 15);
  let pagesCrawled = 0, pagesMissingTitle = 0, pagesMissingMeta = 0, totalImages = 0, pageWeightKb = 0, scriptCount = 0;
  let latest: Date | null = null;
  const broken = new Set<string>();
  const internalLinks = new Set<string>();

  for (const url of candidates) {
    try {
      const r = await axios.get(url, {
        timeout: 8000, maxRedirects: 4,
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        validateStatus: () => true, responseType: 'text', transformResponse: [(d) => d],
      });
      if (r.status >= 400) { broken.add(url); continue; }
      if (typeof r.data !== 'string' || r.data.length < 100) continue;
      pagesCrawled++;
      const html = r.data as string;
      const $ = cheerio.load(html);
      if (!$('head title').first().text().trim()) pagesMissingTitle++;
      if (!$('meta[name="description"]').attr('content')?.trim()) pagesMissingMeta++;
      totalImages += $('img').length;
      mergeAudit(audit, analyzeHtml(html, url));
      if (url === audit.finalUrl) { pageWeightKb = Math.round(html.length / 1024); scriptCount = $('script').length; }
      $('time[datetime]').each((_, el) => {
        const d = new Date($(el).attr('datetime') || '');
        if (!isNaN(+d) && (!latest || d > latest)) latest = d;
      });
      $('a[href]').each((_, el) => {
        const h = $(el).attr('href') || '';
        try { const u = new URL(h, url); if (u.origin === origin) internalLinks.add(u.origin + u.pathname); } catch { /* ignore */ }
      });
    } catch { /* skip page */ }
  }

  // sample internal links we haven't already fetched, and HEAD-check for breakage
  const sample = [...internalLinks].filter((u) => !candidates.includes(u)).slice(0, 12);
  for (const u of sample) {
    try {
      const r = await axios.head(u, { timeout: 6000, maxRedirects: 4, headers: { 'User-Agent': UA }, validateStatus: () => true });
      if (r.status >= 400) broken.add(u);
    } catch { /* HEAD blocked or network blip: don't penalise */ }
  }

  const latestMs = latest ? +(latest as Date) : 0;
  return {
    ranAt: new Date().toISOString(),
    sitemapFound,
    pagesDiscovered: candidates.length,
    pagesCrawled, pagesMissingTitle, pagesMissingMeta, totalImages, pageWeightKb, scriptCount,
    brokenLinks: [...broken].slice(0, 20),
    hasFreshContent: latestMs > 0 && (Date.now() - latestMs < 1000 * 60 * 60 * 24 * 120),
    latestContentDate: latest ? (latest as Date).toISOString().slice(0, 10) : null,
    socials: [],
  };
}

/**
 * Real performance numbers from Google PageSpeed Insights (mobile). Needs
 * GOOGLE_PAGESPEED_API_KEY (works without one too, just lower rate limits). PSI
 * is slow, so we only call it on a deep audit, and never let it block forever.
 */
async function fetchPageSpeed(url: string): Promise<{ performance: number; lcpMs: number; cls: number } | null> {
  try {
    const r = await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
      params: {
        url, strategy: 'mobile', category: 'performance',
        ...(process.env.GOOGLE_PAGESPEED_API_KEY ? { key: process.env.GOOGLE_PAGESPEED_API_KEY } : {}),
      },
      timeout: 30000, validateStatus: () => true,
    });
    if (r.status !== 200) return null;
    const lh = r.data?.lighthouseResult;
    const perf = lh?.categories?.performance?.score;
    if (typeof perf !== 'number') return null;
    const audits = lh?.audits ?? {};
    return {
      performance: Math.round(perf * 100),
      lcpMs: Math.round(audits['largest-contentful-paint']?.numericValue ?? 0),
      cls: Number((audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)),
    };
  } catch { return null; }
}

/**
 * Deep dossier: robust homepage audit, then a full site crawl (sitemap + nav)
 * that merges extra contacts/socials into the audit and produces SEO-health,
 * broken-link, freshness and page-weight findings, plus a best-effort check of
 * each social account.
 */
export async function deepAuditWebsite(browser: Browser, websiteUrl: string): Promise<AuditOutcome> {
  const outcome = await auditWebsite(browser, websiteUrl);
  if (outcome.status !== 'audited' || !outcome.audit) return outcome;
  const audit = outcome.audit;
  const attempts = outcome.attempts;

  let origin = '';
  try { origin = new URL(audit.finalUrl).origin; } catch { return outcome; }

  // Discover nav links from the rendered homepage (catches JS-built menus).
  const page = await browser.newPage();
  let navLinks: string[] = [];
  try {
    await setupStealth(page);
    await page.goto(audit.finalUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await delay(400, 700);
    navLinks = await page.evaluate((org: string) => {
      const skip = /\.(jpg|jpeg|png|webp|gif|svg|pdf|zip|mp4|ico|css|js)$/i;
      const out = new Set<string>();
      document.querySelectorAll('a[href]').forEach((a) => {
        try {
          const u = new URL((a as HTMLAnchorElement).href, location.href);
          if (u.origin === org && !skip.test(u.pathname)) out.add(u.origin + u.pathname);
        } catch { /* ignore */ }
      });
      return [...out];
    }, origin);
  } catch { /* ignore */ } finally { await page.close().catch(() => {}); }

  const report = await buildDeepReport(origin, audit, navLinks);
  report.socials = await enrichSocials(audit.socials);

  // Real Google performance numbers (only on a deep audit — PSI is slow).
  const psi = await fetchPageSpeed(audit.finalUrl);
  if (psi) {
    audit.psiPerformance = psi.performance;
    audit.psiLcpMs = psi.lcpMs;
    audit.psiCls = psi.cls;
    attempts.push(`pagespeed: perf ${psi.performance}, LCP ${(psi.lcpMs / 1000).toFixed(1)}s`);
  }

  audit.socialCount = Object.values(audit.socials).filter(Boolean).length;
  audit.pagesCrawled = report.pagesCrawled;
  attempts.push(`deep dossier: crawled ${report.pagesCrawled}/${report.pagesDiscovered} pages, ${report.brokenLinks.length} broken link(s), ${report.socials.length} social(s) checked`);
  return { status: 'audited', audit, failReason: null, attempts, deepReport: report };
}

// ===========================================================================
// SEO SCORE
// ===========================================================================

export function computeSeoScore(a: WebsiteAudit): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  const add = (label: string, weight: number, ok: boolean, value?: string) =>
    factors.push({ label, weight, awarded: ok ? weight : 0, ok, value });

  add('HTTPS enabled', 8, a.httpsActive);
  add('Page reachable', 6, a.reachable, `${a.httpStatus || 'n/a'}`);
  add('Title tag (10-65 chars)', 10, a.titleLength >= 10 && a.titleLength <= 65, `${a.titleLength} chars`);
  add('Meta description (50-160)', 10, a.metaDescriptionLength >= 50 && a.metaDescriptionLength <= 160, `${a.metaDescriptionLength} chars`);
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
  add('Page speed (<3s)', 8, fast, a.loadTimeMs > 0 ? `${(a.loadTimeMs / 1000).toFixed(2)}s` : 'n/a');
  add('Analytics installed', 4, a.hasGoogleAnalytics || a.hasGoogleTagManager);
  add('Social presence linked', 2, Object.values(a.socials).some(Boolean));

  const score = factors.reduce((acc, f) => acc + f.awarded, 0);
  return { score, factors };
}

// ===========================================================================
// DIGITAL PRESENCE SCORE — five dimensions rolled into one 0-100 figure
// ===========================================================================

const PRESENCE_WEIGHTS: Record<keyof PresenceDimensions, number> = {
  site: 0.30, social: 0.22, marketing: 0.20, reputation: 0.14, content: 0.14,
};

const DIMENSION_BLURBS: Record<keyof PresenceDimensions, string> = {
  site:       "How good their website is across security, speed, mobile, and on-page SEO.",
  social:     "Whether they're on the social platforms that matter (Instagram especially).",
  marketing:  "Do they run real marketing like tracking pixels, ads, lead capture, and booking.",
  reputation: "Their Google rating and how many reviews they've earned.",
  content:    "Do they publish substantial, fresh content (copy, blog, structured data).",
};

const DIMENSION_LABELS: Record<keyof PresenceDimensions, string> = {
  site: "Website", social: "Social", marketing: "Marketing", reputation: "Reputation", content: "Content",
};

function buildFactors(rows: Array<[string, number, boolean, string?]>, awardedOverride?: number[]): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = rows.map(([label, weight, ok, value], i) => ({
    label, weight, ok, value,
    awarded: awardedOverride ? awardedOverride[i] : (ok ? weight : 0),
  }));
  return { score: Math.round(factors.reduce((a, f) => a + f.awarded, 0)), factors };
}

export interface PresenceResult {
  overall: number;
  dimensions: PresenceDimensions;
  siteFactors: ScoreFactor[];
  dimensionFactors: DimensionBreakdown[];
}

export function computePresence(o: {
  audit?: WebsiteAudit;
  websiteStatus: WebsiteStatus;
  rating: number;
  reviewCount: number;
  socials?: Socials;       // best-known socials (website + Maps + search), if discovered
  followers?: number;      // largest follower count across their social accounts
}): PresenceResult {
  const a = o.audit;
  const audited = o.websiteStatus === "audited" && !!a;

  // ---- SITE ----
  const site = audited
    ? computeSeoScore(a!)
    : buildFactors([["Website reachable", 100, false, o.websiteStatus === "none" ? "no website" : "unreachable"]]);

  // ---- SOCIAL (works even without a website: socials can come from Maps or search) ----
  const soc = o.socials ?? a?.socials;
  const sc = soc ? countSocials(soc) : 0;
  const followers = o.followers ?? 0;
  const social = (audited || sc > 0)
    ? buildFactors([
        ["Any social profile", 25, sc >= 1, `${sc} found`],
        ["Instagram", 25, !!soc?.instagram],
        ["Facebook", 15, !!soc?.facebook],
        ["Multiple platforms (2+)", 15, sc >= 2],
        ["Engaged audience (1k+ followers)", 20, followers >= 1000, followers > 0 ? `${followers.toLocaleString()} followers` : undefined],
      ])
    : buildFactors([["Social profiles", 100, false, "none found"]]);

  // ---- MARKETING ----
  const marketing = audited
    ? buildFactors([
        ["Analytics installed", 25, a!.hasGoogleAnalytics || a!.hasGoogleTagManager],
        ["Ad pixel installed", 25, a!.adPixels.length > 0, a!.adPixels.join(", ") || undefined],
        ["Email / lead capture", 20, a!.hasEmailCapture],
        ["Online booking / ordering", 20, a!.hasBooking],
        ["Live chat", 10, a!.hasLiveChat],
      ])
    : buildFactors([["Detected from website", 100, false, "no website to scan"]]);

  // ---- REPUTATION (works without a website — comes from the Maps listing) ----
  const ratingAwarded = Math.round(Math.min(o.rating, 5) / 5 * 50);
  const revAwarded = Math.round(Math.min(o.reviewCount, 200) / 200 * 50);
  const reputation = buildFactors(
    [
      ["Star rating", 50, o.rating >= 4.0, o.rating ? `${o.rating.toFixed(1)}★` : "no rating"],
      ["Review volume", 50, o.reviewCount >= 20, `${o.reviewCount} reviews`],
    ],
    [ratingAwarded, revAwarded],
  );

  // ---- CONTENT ----
  const content = audited
    ? buildFactors([
        ["Substantial copy (300+ words)", 30, a!.wordCount >= 300, `${a!.wordCount} words`],
        ["Section headings (3+ H2)", 15, a!.h2Count >= 3, `${a!.h2Count} H2`],
        ["Blog / news section", 25, a!.hasBlog],
        ["Images present (5+)", 15, a!.imageCount >= 5, `${a!.imageCount} images`],
        ["Structured data (schema)", 15, a!.jsonLd],
      ])
    : buildFactors([["Detected from website", 100, false, "no website to scan"]]);

  const dimensions: PresenceDimensions = {
    site: site.score,
    social: social.score,
    marketing: marketing.score,
    reputation: reputation.score,
    content: content.score,
  };

  const overall = Math.round(
    (Object.keys(PRESENCE_WEIGHTS) as Array<keyof PresenceDimensions>)
      .reduce((sum, k) => sum + PRESENCE_WEIGHTS[k] * dimensions[k], 0),
  );

  const byKey = { site, social, marketing, reputation, content };
  const dimensionFactors: DimensionBreakdown[] =
    (Object.keys(PRESENCE_WEIGHTS) as Array<keyof PresenceDimensions>).map((k) => ({
      key: k,
      label: DIMENSION_LABELS[k],
      score: dimensions[k],
      weight: Math.round(PRESENCE_WEIGHTS[k] * 100),
      blurb: DIMENSION_BLURBS[k],
      factors: byKey[k].factors,
    }));

  return { overall, dimensions, siteFactors: site.factors, dimensionFactors };
}

// ===========================================================================
// TOP-LEVEL FLOW
// ===========================================================================

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--lang=en-US,en',
    ],
  });
  try { return await fn(browser); } finally { await browser.close().catch(() => {}); }
}

/** How many leads to audit in parallel. A headless browser handles a few pages
 *  at once fine; keep it modest so we don't trip Maps/social rate limits. */
export const LEAD_CONCURRENCY = Math.min(Math.max(Number(process.env.SCANMAP_CONCURRENCY) || 4, 1), 8);

/**
 * Run `worker` over `items` with at most `concurrency` in flight. Stops pulling
 * new work as soon as `shouldStop` returns true. JS is single-threaded, so the
 * shared counters the workers touch are safe; caps may overshoot by < concurrency.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop?: () => boolean,
): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      if (shouldStop?.()) return;
      const idx = next++;
      await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, run));
}

export async function discoverTargets(
  browser: Browser, niche: string, location: string, scanLimit: number,
  onProgress?: (done: number, total: number, name: string) => void,
  skipLink?: (link: string) => boolean,
): Promise<MapsTarget[]> {
  const placeLinks = await discoverPlaceLinks(browser, niche, location, scanLimit);
  const targets: MapsTarget[] = [];
  for (let i = 0; i < placeLinks.length; i++) {
    const link = placeLinks[i];
    // Skip businesses already in the library — don't waste an audit on them.
    if (skipLink?.(link)) {
      onProgress?.(i + 1, placeLinks.length, 'already in library, skipped');
      continue;
    }
    const t = await extractMapsTarget(browser, link);
    if (t) targets.push(t);
    onProgress?.(i + 1, placeLinks.length, t?.name ?? '…');
  }
  return targets;
}

export async function buildLeadFromTarget(browser: Browser, target: MapsTarget, category?: string, opts?: { deep?: boolean }): Promise<Lead> {
  const allAttempts: string[] = [];
  if (target.extractionNotes.length > 0) {
    allAttempts.push(`maps extraction: ${target.extractionNotes.join(', ')}`);
  }
  if (target.rawWebsite && target.website && target.rawWebsite !== target.website) {
    allAttempts.push(`unwrapped: ${target.rawWebsite} → ${target.website}`);
  }

  let websiteStatus: WebsiteStatus = 'none';
  let websiteFailReason: string | null = null;
  let audit: WebsiteAudit | undefined;
  let deepReport: DeepReport | undefined;
  let mainEmail = 'No email found';
  let primaryTech = 'Unknown';

  if (target.website) {
    const outcome = opts?.deep
      ? await deepAuditWebsite(browser, target.website)
      : await auditWebsite(browser, target.website);
    websiteStatus = outcome.status;
    websiteFailReason = outcome.failReason;
    audit = outcome.audit;
    deepReport = outcome.deepReport;
    allAttempts.push(...outcome.attempts);

    if (outcome.status === 'audited' && audit) {
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
  } else {
    allAttempts.push('no website on Maps listing');
  }

  // ---- best-known socials: website audit links + Maps listing + web-search fallback ----
  const socialsSource: ("website" | "maps" | "search")[] = [];
  let socials = mergeSocials(audit?.socials, target.socials);
  if (audit && countSocials(audit.socials) > 0) socialsSource.push("website");
  if (countSocials(target.socials) > 0) socialsSource.push("maps");
  // Search the open web for socials when we know none, OR on a deep audit always
  // (a deep audit re-searches to turn up extra platforms we may have missed).
  if (countSocials(socials) === 0 || opts?.deep) {
    const searched = await findSocials(target.name, baliAreaOf(target.address), category);
    const before = countSocials(socials);
    if (countSocials(searched) > 0) {
      socials = mergeSocials(socials, searched);
      if (countSocials(socials) > before) {
        if (!socialsSource.includes("search")) socialsSource.push("search");
        allAttempts.push(`web-search socials: ${countSocials(socials) - before} new (${countSocials(socials)} total)`);
      }
    }
  }
  const socialCount = countSocials(socials);
  // Fold the merged socials back into the audit so the website's social score
  // benefits from links we found on Maps or via search, not just on the page.
  if (audit) { audit.socials = socials; audit.socialCount = socialCount; }

  // ---- enrich each social account with real public stats (followers, posts, etc.) ----
  const socialInsights = socialCount > 0 ? await enrichSocials(socials) : [];
  const maxFollowers = socialInsights.reduce((m, s) => Math.max(m, s.followers ?? 0), 0);
  if (socialInsights.some((s) => s.followers !== undefined)) {
    allAttempts.push(`social stats: ${socialInsights.filter((s) => s.followers !== undefined).map((s) => `${s.platform} ${s.followers}`).join(', ')}`);
  }
  // Harvest contact details from the socials when the website didn't give us any
  // (this is how no-website leads get an email / WhatsApp at all).
  let harvestedWhatsApp: string | null = null;
  let harvestedEmail: string | null = null;
  for (const s of socialInsights) {
    if (!harvestedWhatsApp && s.bio) harvestedWhatsApp = whatsappFromText(s.bio);
    if (!harvestedEmail && s.email) harvestedEmail = s.email;
    if (!harvestedEmail && s.bio) {
      const m = s.bio.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      if (m && !NOISE_EMAILS.some((n) => m[0].toLowerCase().includes(n))) harvestedEmail = m[0];
    }
  }
  if (mainEmail === 'No email found' && harvestedEmail) mainEmail = harvestedEmail;

  // ---- combined Digital Presence score across all five dimensions ----
  const presence = computePresence({
    audit, websiteStatus, rating: target.rating, reviewCount: target.reviewCount, socials, followers: maxFollowers,
  });
  const score = presence.overall;

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

  const opportunities = detectOpportunities({
    websiteStatus,
    tech: primaryTech,
    audit,
    dimensions: presence.dimensions,
    rating: target.rating,
    reviewCount: target.reviewCount,
    isSocialOnly: audit?.isSocialOnly ?? false,
    socials,
    socialInsights,
  });

  const lead: Lead = {
    id: Math.random().toString(36).slice(2, 11),
    name: target.name,
    url: finalUrl,
    websiteFromMaps: target.website,
    websiteStatus,
    websiteFailReason,
    auditAttempts: allAttempts,
    email: mainEmail,
    whatsapp: audit?.whatsapp ?? harvestedWhatsApp ?? null,
    opportunities,
    tech: primaryTech,
    category,
    rating: target.rating,
    reviews: target.reviews,
    reviewCount: target.reviewCount,
    address: target.address,
    phone: target.phone,
    mapsUrl: target.mapsUrl,
    isSocialUrl: audit?.isSocialOnly ?? false,
    authorityScore: target.authorityScore,
    stats: { score, riskLevel, dimensions: presence.dimensions },
    scoreFactors: presence.siteFactors,
    dimensionFactors: presence.dimensionFactors,
    audit,
    deepReport,
    socials,
    socialsSource,
    socialInsights,
    pitch: buildPitch(websiteStatus, opportunities, websiteFailReason),
    lastAuditedAt: new Date().toISOString(),
  };
  return lead;
}

export async function reauditLead(existing: Lead, opts?: { deep?: boolean }): Promise<Lead> {
  return await withBrowser(async (browser) => {
    const target = await extractMapsTarget(browser, existing.mapsUrl);
    if (!target) {
      return {
        ...existing,
        auditAttempts: [...(existing.auditAttempts ?? []), 'maps page not retrievable'],
        lastAuditedAt: new Date().toISOString(),
      };
    }
    const fresh = await buildLeadFromTarget(browser, target, existing.category, opts);
    return {
      ...fresh,
      id: existing.id,
      status: existing.status,
      notes: existing.notes,
      date: existing.date,
    };
  });
}

/** Re-audit many existing leads sequentially in one browser. Yields events. */
export async function* reauditMany(existing: Lead[]): AsyncGenerator<{
  type: 'progress' | 'lead' | 'error'; index?: number; total?: number; lead?: Lead; msg?: string;
}> {
  yield { type: 'progress', index: 0, total: existing.length, msg: `Re-auditing ${existing.length} lead(s)...` };
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', '--lang=en-US,en',
    ],
  });
  try {
    for (let i = 0; i < existing.length; i++) {
      const e = existing[i];
      try {
        const target = await extractMapsTarget(browser, e.mapsUrl);
        if (!target) {
          yield { type: 'error', index: i, total: existing.length, msg: `${e.name}: Maps page not retrievable` };
          continue;
        }
        const fresh = await buildLeadFromTarget(browser, target, e.category);
        const refreshed: Lead = {
          ...fresh,
          id: e.id,
          status: e.status,
          notes: e.notes,
          date: e.date,
        };
        yield { type: 'lead', index: i, total: existing.length, lead: refreshed };
      } catch (err) {
        yield { type: 'error', index: i, total: existing.length, msg: `${e.name}: ${err instanceof Error ? err.message : 'unknown'}` };
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

function buildPitch(
  status: WebsiteStatus, opportunities: Opportunity[], failReason: string | null,
): string {
  if (status === 'none') {
    return 'Not online with a real website. Prime candidate for a website build plus full digital presence.';
  }
  if (status === 'unreachable') {
    return `Their website is down (${failReason ?? 'unreachable'}). Rebuild plus recovery opportunity.`;
  }
  if (opportunities.length === 0) {
    return 'Already a strong digital presence. Approach as a premium optimisation or retainer client.';
  }
  // Lead with the distinct services these gaps map to (what you can sell them).
  const sells = [...new Set(opportunities.map(o => OPPORTUNITY_META[o].sell))].slice(0, 3);
  return `Best angles to sell: ${sells.join(' · ')}.`;
}

// exported for offline tests (not used by the app)
export const __findSocials = findSocials;
export const __socialsFromUrls = socialsFromUrls;
export const __handleMatchesName = handleMatchesName;
export const __enrichSocials = enrichSocials;
