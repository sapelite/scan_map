import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 1. Tell Next.js we are aware of Turbopack to silence the error
  turbopack: {},

  // 2. Standard way to handle Puppeteer in modern Next.js
  serverExternalPackages: ["puppeteer"],

  // 3. Keep the webpack fallback for non-Turbopack environments (like production builds)
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('puppeteer');
    }
    return config;
  },
};

export default nextConfig;