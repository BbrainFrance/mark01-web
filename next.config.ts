import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permettre les requetes vers le VPS
  async rewrites() {
    return [];
  },
};

export default nextConfig;
