import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the workspace root explicitly: without this, Turbopack's root
  // inference can walk up to a lockfile outside this repo (e.g. one in the
  // user's home directory) and misdetect the project root.
  turbopack: {
    root: path.join(import.meta.dirname),
  },
  // The service worker must never be served stale, or a fix to it would take a day to land.
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;
