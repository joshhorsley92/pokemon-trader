import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let a phone on the local network load the client bundle for the
  // booth flow. Without this, Next 16 blocks cross-origin dev assets from the
  // LAN IP and the page renders but never hydrates. Production is unaffected.
  allowedDevOrigins: ["192.168.1.16", "192.168.1.*"],
  // Hide the on-screen Next.js dev indicator (the "N" bubble). Compile and
  // runtime errors are still surfaced.
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "tcgplayer-cdn.tcgplayer.com",
      },
    ],
  },
};

export default nextConfig;
