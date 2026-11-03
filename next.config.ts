import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Extra hostnames allowed to reach the dev server, for testing on a
  // phone through a tunnel. Set DEV_ORIGINS in .env.local, comma separated.
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(",") ?? [],
};

export default nextConfig;
