import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';
import {
  Lead, WebsiteAudit, ScoreFactor, Socials, WebsiteStatus,
} from './types';

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
  website: string | null;
  rawWebsite: string | null;
  address: string;
  phone: string;
  mapsUrl: string;
  authorityScore: number;
  extractionNotes: string[];
}

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

async function discoverPlaceLinks(browser: Browser, niche: string, location: string, scanLimit: number): Promise<string[]> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    const query = encodeURIComponent(`${niche} in ${location}`);
    const searchUrl = `https://www.google.com/maps/search/${query}?hl=en`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
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
async function extractMapsTarget(browser: Browser, link: string): Promise<MapsTarget | null> {
  const page = await browser.newPage();
  const notes: string[] = [];
  try {
    await page.setUserAgent(UA);
    await page.goto(link, { waitUntil: 'networkidle2', timeout: 35000 });

    // Wait for ANY indicator that the place panel is hydrated. Race so we
    // don't wait the full 12s on places that hydrate fast.
    try {
      await Promise.race([
        page.waitForSelector('a[data-item-id="authority"]', { timeout: 12000 }),
        page.waitForSelector('button[data-item-id="address"]', { timeout: 12000 }),
        page.waitForSelector('button[data-item-id*="phone"]', { timeout: 12000 }),
        page.waitForSelector('h1.DUwDvf', { timeout: 12000 }),
      ]);
    } catch { notes.push('panel-hydration-timeout'); }

    // Settle additional async DOM
    await delay(1500, 2500);

    const details = await page.evaluate(() => {
      const getText = (el: Element | null) => (el as HTMLElement | null)?.innerText || '';

      // ----- Name -----
      const name = getText(document.querySelector('h1.DUwDvf, h1')) || 'Unknown Business';

      // ----- Rating / reviews -----
      const ratingStr = document.querySelector('span[role="img"][aria-label*="stars"]')
        ?.getAttribute('aria-label')?.split(' ')[0];
      const rating = parseFloat(ratingStr || '0');
      const reviews = getText(document.querySelector('button[aria-label*="reviews"]')) || '0';

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

      return { name, rating, reviews, website, raw, address, phone, usedNotes };
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
// SEO SCORE
// ===========================================================================

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

export async function discoverTargets(
  browser: Browser, niche: string, location: string, scanLimit: number,
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
  let factors: ScoreFactor[] = [];
  let score = 0;
  let mainEmail = 'No email found';
  let primaryTech = 'Unknown';

  if (target.website) {
    const outcome = await auditWebsite(browser, target.website);
    websiteStatus = outcome.status;
    websiteFailReason = outcome.failReason;
    audit = outcome.audit;
    allAttempts.push(...outcome.attempts);

    if (outcome.status === 'audited' && audit) {
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
  } else {
    allAttempts.push('no website on Maps listing');
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

  return {
    id: Math.random().toString(36).slice(2, 11),
    name: target.name,
    url: finalUrl,
    websiteFromMaps: target.website,
    websiteStatus,
    websiteFailReason,
    auditAttempts: allAttempts,
    email: mainEmail,
    tech: primaryTech,
    rating: target.rating,
    reviews: target.reviews,
    address: target.address,
    phone: target.phone,
    mapsUrl: target.mapsUrl,
    isSocialUrl: audit?.isSocialOnly ?? false,
    authorityScore: target.authorityScore,
    stats: { score, riskLevel },
    scoreFactors: factors,
    audit,
    pitch: buildPitch(target.name, websiteStatus, primaryTech, factors, websiteFailReason),
    lastAuditedAt: new Date().toISOString(),
  };
}

export async function reauditLead(existing: Lead): Promise<Lead> {
  return await withBrowser(async (browser) => {
    const target = await extractMapsTarget(browser, existing.mapsUrl);
    if (!target) {
      return {
        ...existing,
        auditAttempts: [...(existing.auditAttempts ?? []), 'maps page not retrievable'],
        lastAuditedAt: new Date().toISOString(),
      };
    }
    const fresh = await buildLeadFromTarget(browser, target);
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
        const fresh = await buildLeadFromTarget(browser, target);
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
  _name: string, status: WebsiteStatus, _tech: string, factors: ScoreFactor[], failReason: string | null,
): string {
  if (status === 'none') return 'No website on Google Maps listing.';
  if (status === 'unreachable') return `Site unreachable: ${failReason ?? 'unknown'}.`;
  const fails = factors.filter(f => !f.ok).map(f => f.label);
  if (fails.length === 0) return 'Site passes all audit checks.';
  return `Issues found: ${fails.slice(0, 4).join(', ')}${fails.length > 4 ? `, and ${fails.length - 4} more` : ''}.`;
}
