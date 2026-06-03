# Scanmap runs a persistent Node server with a real Chromium (Puppeteer) and
# does long-running scans that write to leads.json. Deploy it on a container
# host that keeps a process alive: Render, Railway, Fly.io, or a VPS.
# It will NOT work on serverless (Vercel / Netlify): no Chromium, short
# function timeouts, and a read-only filesystem.

FROM node:22-bookworm-slim

# Chromium runtime libraries that Puppeteer needs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation wget \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxrandr2 libxkbcommon0 libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Keep Puppeteer's downloaded Chromium inside the image so install and runtime agree.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Install dependencies first (also downloads the matching Chromium build).
COPY package.json package-lock.json* ./
RUN npm ci

# Build the Next.js production bundle.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
