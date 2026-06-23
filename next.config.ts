import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // Keep the y-stack out of the Next.js bundle so the server uses Node's
  // resolution and loads each package exactly once. Bundling them caused the
  // "Yjs was already imported" warning — Next was loading the ESM build while
  // a transitive (e.g. y-protocols) loaded the CJS build.
  serverExternalPackages: [
    "yjs",
    "y-protocols",
    "y-monaco",
    "y-websocket",
    "@hocuspocus/provider",
    "@hocuspocus/server",
  ],
  // /api/deploy-to-vercel reads these at runtime as the shadcn snapshot for
  // sessions whose sandbox has died. Force them into the serverless bundle.
  outputFileTracingIncludes: {
    "/api/deploy-to-vercel": [
      "src/components/ui/**",
      "src/lib/utils.ts",
    ],
  },
  allowedDevOrigins: [
    "http://192.168.1.103:3000",
    "http://192.168.1.108:3000",
    '192.168.1.110',
    "http://192.168.*.*:3000",
  ],
};

export default nextConfig;
