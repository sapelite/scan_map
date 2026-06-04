# Scanmap by Customy

A Bali lead-finder. It scans Google Maps for local businesses, scores their online
presence (website, social, marketing, reputation, content), and drops every lead onto
a live map so you can prospect and reach out.

This guide gets it running on your own computer from the zip, step by step. No coding needed.

---

## 1. Install Node.js (one time)

Scanmap runs on Node.js (which includes `npm`). If you don't have it yet:

1. Go to **https://nodejs.org**
2. Download the **LTS** version (the big green button). Pick version **20 or newer** (22 is ideal).
3. Run the installer and click through with the default options.
4. To check it worked, open a terminal (see below) and type:
   ```
   node -v
   ```
   You should see a version number like `v22.x.x`. If you do, you're set.

**How to open a terminal in the project folder:**

- **Windows:** unzip the folder, open it, then in the address bar at the top type `powershell` and press Enter. (Or hold Shift, right-click an empty spot in the folder, and choose "Open PowerShell window here".)
- **Mac:** unzip the folder, open the Terminal app, type `cd ` (with a space), then drag the unzipped folder onto the Terminal window and press Enter.

---

## 2. Install the app's dependencies (one time)

In that terminal, inside the project folder, run:

```
npm install
```

This downloads everything the app needs. **The first install also downloads a small
browser (Chromium) that Scanmap uses to scan Google Maps**, so it can take a few minutes
and needs an internet connection. Let it finish. A few yellow warnings are normal.

---

## 3. Launch the app

```
npm run dev
```

When you see a line like `Local: http://localhost:3000`, open that link in your
browser (Chrome, Edge, etc.). That's the app.

To **stop** it, click the terminal and press `Ctrl + C`.

To start it again later, just open the terminal in the folder and run `npm run dev` again.

---

## Using it quickly

- **Bali Sweep:** pick what kind of businesses and which areas to hunt, then watch leads
  appear on the map as it scans.
- **Find:** a quick one-off search for a single niche in one place.
- **Library:** every lead you've found, with filters, CSV export, and PDF reports.
- Click any dot on the map to open that lead.

You need an internet connection while scanning (it reads Google Maps) and to load the map.

Your leads are saved in a file called `leads.json` inside the folder, so they stay between sessions.

### Social discovery (followers, Instagram, etc.)

For each business the scan also looks up its socials and pulls public stats (Instagram
followers and posts, TikTok, and so on). It finds socials three ways: links on their
website, links on their Google listing, and a web search when neither has them.

The website and Google-listing sources, plus the follower/post stats, all work for
free with no setup. The **web-search** step (used only when a business has no website
and no social link on its listing) is the one part that can get rate-limited.

- **Default (no setup):** it scrapes Brave. Fine for one-off searches and small sweeps,
  but it gets throttled if you scan a lot at once, so it backs off and finds fewer.
- **For reliable big sweeps**, add one of these to `.env`:
  - `GOOGLE_CSE_ID` — free, 100 searches/day. You already have a Google key; just create
    a free search engine at https://programmablesearchengine.google.com (set it to search
    the whole web) and paste its ID.
  - `BRAVE_SEARCH_API_KEY` — Brave's API. Has a free tier (~2,000/month, needs a card on
    file) and paid plans (about $5 per 1,000). Key from https://brave.com/search/api/

It never attaches a social account it isn't confident belongs to the business, so a
throttled search just means fewer socials found, never wrong ones.

---

## If something goes wrong

- **"Port 3000 is in use":** another copy is already running. Close the other terminal,
  or just use the address it prints instead (for example `http://localhost:3001`).
- **It won't start after a crash, mentions a "lock":** delete the `.next` folder inside the
  project, then run `npm run dev` again.
- **The install failed or the app acts broken:** delete the `node_modules` folder and the
  `.next` folder, then run `npm install` again, then `npm run dev`.
- **A scan finds nothing:** check your internet connection and try a different niche or area.

---

## Optional: run the faster "production" version

For everyday use the steps above are fine. If you want the optimized build:

```
npm run build
npm run start
```

Then open `http://localhost:3000` as before.

---

Made by Customy. To put this online for a team instead of one computer, see `DEPLOY.md`.
