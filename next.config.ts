import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permet l'accès dev depuis l'IP du serveur (en plus de localhost)
  allowedDevOrigins: ["102.36.137.37", "aibotmanager.unchk.sn"],
};

export default nextConfig;
