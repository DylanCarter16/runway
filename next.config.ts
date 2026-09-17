import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the workspace root explicitly: without this, Turbopack's root
  // inference can walk up to a lockfile outside this repo (e.g. one in the
  // user's home directory) and misdetect the project root.
  turbopack: {
    root: path.join(import.meta.dirname),
  },
};

export default nextConfig;
