import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: [
    "http://192.168.1.103:3000",
    "http://192.168.*.*:3000",
  ],
};

export default nextConfig;
