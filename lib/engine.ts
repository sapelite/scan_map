import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';
import {
  Lead, WebsiteAudit, ScoreFactor, Socials, WebsiteStatus, Opportunity,
  PresenceDimensions, DimensionBreakdown, OPPORTUNITY_META, DeepReport, SocialCheck,
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
  reviewCount: number;
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

      return { name, rating, reviews, reviewCount, website, raw, address, phone, usedNotes };
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
      reviewCount: details.reviewCount || 0,
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
}): Opportunity[] {
  const opps: Opportunity[] = [];
  const a = o.audit;

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
    // social
    if (a.socialCount === 0) opps.push("no_social");
    else {
      if (!a.socials.instagram) opps.push("no_instagram");
      if (a.socialCount === 1) opps.push("dormant_social");
    }
  }

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

/** Best-effort check of each social account. Platforms gate public data behind
 *  login walls, so we report liveness + whatever public meta renders, honestly. */
async function checkSocials(socials: Socials): Promise<SocialCheck[]> {
  const entries = (Object.entries(socials) as [string, string | null][]).filter(([, u]) => !!u) as [string, string][];
  const out: SocialCheck[] = [];
  for (const [key, url] of entries) {
    const platform = PLATFORM_LABEL[key] || key;
    try {
      const r = await axios.get(url, {
        timeout: 9000, maxRedirects: 4,
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        validateStatus: () => true, responseType: 'text', transformResponse: [(d) => d],
      });
      const live = r.status >= 200 && r.status < 400;
      let title: string | null = null;
      let note = '';
      if (live && typeof r.data === 'string') {
        const head = r.data.slice(0, 6000);
        const m = head.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || head.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = m ? m[1].trim().replace(/\s+/g, ' ').slice(0, 120) : null;
        if (/log in|login|sign up|create an account|see posts/i.test(head) && /(instagram|facebook|tiktok|linkedin)\./i.test(url)) {
          note = 'public data limited (login wall)';
        }
      } else if (!live) {
        note = `HTTP ${r.status}`;
      }
      out.push({ platform, url, live, title, note });
    } catch {
      out.push({ platform, url, live: false, title: null, note: 'unreachable' });
    }
  }
  return out;
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
  report.socials = await checkSocials(audit.socials);

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
}): PresenceResult {
  const a = o.audit;
  const audited = o.websiteStatus === "audited" && !!a;

  // ---- SITE ----
  const site = audited
    ? computeSeoScore(a!)
    : buildFactors([["Website reachable", 100, false, o.websiteStatus === "none" ? "no website" : "unreachable"]]);

  // ---- SOCIAL ----
  const social = audited
    ? buildFactors([
        ["Any social profile linked", 30, a!.socialCount >= 1, `${a!.socialCount} linked`],
        ["Instagram", 30, !!a!.socials.instagram],
        ["Facebook", 20, !!a!.socials.facebook],
        ["Multiple platforms (2+)", 20, a!.socialCount >= 2],
      ])
    : buildFactors([["Detected from website", 100, false, "no website to scan"]]);

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

  // ---- combined Digital Presence score across all five dimensions ----
  const presence = computePresence({
    audit, websiteStatus, rating: target.rating, reviewCount: target.reviewCount,
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
    whatsapp: audit?.whatsapp ?? null,
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
