import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { Lead } from './types';

interface MapsTarget {
    name: string;
    rating: number;
    reviews: string;
    website: string | null;
    address: string;
    phone: string;
    mapsUrl: string;
    authorityScore: number;
}

const delay = (min: number, max: number) => 
    new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

const socialDomains = ['instagram.com', 'facebook.com', 'linktr.ee', 'tiktok.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com'];

export const findLeads = async (niche: string, location: string, scanLimit: number = 10) => {
    const query = encodeURIComponent(`${niche} in ${location}`);
    const browser = await puppeteer.launch({ 
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // TARGET GOOGLE MAPS DIRECTLY WITH LANGUAGE FORCED TO ENGLISH
        const searchUrl = `https://www.google.com/maps/search/${query}?hl=en`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // POLYMORPHIC CONSENT BYPASS (Handles multiple languages/layouts)
        try {
            await delay(1000, 2000);
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const text = await page.evaluate(el => el.innerText, button);
                if (text.includes('Accept all') || text.includes('Agree') || text.includes('Accepter')) {
                    await button.click();
                    await page.waitForNavigation({ waitUntil: 'networkidle2' });
                    break;
                }
            }
        } catch { /* No consent found */ }

        // MULTI-SELECTOR WAIT (Feed or Results list)
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

        const placeLinks = await page.evaluate((limit) => 
            Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => href.includes('/maps/place/'))
                .slice(0, limit), scanLimit);

        const candidates: MapsTarget[] = [];
        for (const link of placeLinks) {
            try {
                await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForSelector('h1', { timeout: 10000 });

                const details = await page.evaluate(() => {
                    const getText = (el: Element | null) => (el as HTMLElement)?.innerText || "";
                    const name = getText(document.querySelector('h1')) || "Unknown Business";
                    const ratingStr = document.querySelector('span[role="img"][aria-label*="stars"]')?.getAttribute('aria-label')?.split(' ')[0];
                    const rating = parseFloat(ratingStr || "0");
                    const reviews = getText(document.querySelector('button[aria-label*="reviews"]')) || "0";
                    const webBtn = document.querySelector('a[data-item-id="authority"]') as HTMLAnchorElement;
                    const address = document.querySelector('button[data-item-id="address"]')?.getAttribute('aria-label')?.replace('Address: ', '') || "No Address";
                    const phone = document.querySelector('button[data-item-id*="phone"]')?.getAttribute('aria-label')?.replace('Phone: ', '') || "No Phone";
                    return { name, rating, reviews, website: webBtn?.href || null, address, phone };
                });
                candidates.push({ ...details, mapsUrl: link, authorityScore: (details.rating || 0) * 10 });
            } catch { continue; }
        }
        return candidates;
    } catch (error) {
        console.error("Critical Extraction Error:", error);
        return [];
    } finally {
        await browser.close();
    }
};

export const processLead = async (lead: MapsTarget): Promise<Lead> => {
    // Logic remains mostly the same, ensuring robust types
    let finalUrl = lead.website;
    let isSocialUrl = false;
    let tech = "Custom Code";
    let email = "No Email Found";
    let score = Math.floor(Math.random() * (70 - 45) + 45);

    if (lead.website) {
        try {
            const response = await axios.get(lead.website, { 
                timeout: 8000, 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                validateStatus: () => true 
            });
            if (response.request.res?.responseUrl) {
                finalUrl = response.request.res.responseUrl;
                isSocialUrl = socialDomains.some(d => finalUrl?.toLowerCase().includes(d));
            }
            const $ = cheerio.load(response.data);
            const html = response.data.toLowerCase();
            if (html.includes('wp-content')) tech = "WordPress";
            else if (html.includes('shopify.com')) tech = "Shopify";
            else if (html.includes('wix.com')) tech = "Wix";
            const emailMatch = $('body').text().match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi);
            if (emailMatch) email = [...new Set(emailMatch)][0]; 
        } catch { score = Math.floor(Math.random() * (30 - 15) + 15); }
    } else { score = 0; }

    if (isSocialUrl) score = Math.min(score, 25);
    return {
        ...lead,
        id: Math.random().toString(36).substr(2, 9),
        url: finalUrl || "No Website Detected",
        email, tech, isSocialUrl,
        stats: { score, riskLevel: score < 30 ? "Critical" : score < 60 ? "High Risk" : "Medium" },
        pitch: `Hello ${lead.name}, I noticed your digital presence could be optimized to capture more market share...`
    };
};