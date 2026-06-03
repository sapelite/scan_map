# Deploying Scanmap

## Why it didn't work before

Scanmap is not a normal static site. It:

1. Drives a real **Chromium browser** (Puppeteer) to scrape Google Maps.
2. Runs **long scans** (a sweep can take minutes).
3. **Writes** results to `leads.json` on disk.

Serverless hosts (**Vercel, Netlify**) can't do any of those: there's no Chromium, functions time out after seconds, and the filesystem is read-only. That's why a Vercel deploy fails at runtime even though the build succeeds.

You need a host that keeps a **Node process alive with a real browser**. The included `Dockerfile` does exactly that, so the app runs the same anywhere that accepts a container.

## Recommended: Render (easiest)

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New > Web Service**, point it at the repo.
3. Render auto-detects the `Dockerfile`. Set:
   - Instance type: at least **1 GB RAM** (Chromium is hungry).
   - Health check path: `/`
4. (Optional, to keep leads across redeploys) add a **Disk**: mount path `/data`, then set env var `SCANMAP_DATA_DIR=/data`.
5. Deploy. Render gives you a public URL.

## Railway

1. New Project > Deploy from GitHub repo.
2. Railway uses the `Dockerfile` automatically.
3. (Optional) add a **Volume** mounted at `/data` and env `SCANMAP_DATA_DIR=/data`.
4. Deploy.

## Fly.io

```bash
fly launch            # detects the Dockerfile, creates fly.toml
fly volumes create data --size 1   # optional, for persistence
# in fly.toml, mount it at /data and set SCANMAP_DATA_DIR=/data, then:
fly deploy
```
Give the machine **1 GB+ RAM** (`fly scale memory 1024`).

## Any VPS (DigitalOcean, Hetzner, etc.)

```bash
docker build -t scanmap .
docker run -d --name scanmap -p 80:3000 \
  -v /srv/scanmap-data:/data -e SCANMAP_DATA_DIR=/data \
  scanmap
```

## Notes

- **Persistence:** without a mounted volume, `leads.json` resets on every redeploy. Mount a disk/volume and set `SCANMAP_DATA_DIR` to keep your library.
- **Memory:** Chromium needs room. 512 MB is tight; 1 GB+ is comfortable.
- **It's single-user / no auth.** If it's public, anyone with the URL can run scans and see leads. Put it behind a login or a private network if that matters.
- **Local production test:** `npm run build && npm run start`, then open http://localhost:3000.
