import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "http://192.168.1.103:3000",
    "http://192.168.*.*:3000",
  ],
};

export default nextConfig;
