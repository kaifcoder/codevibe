import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Auth-gated app surfaces + machine endpoints have no SEO value and
        // would only burn crawl budget. Block them explicitly.
        disallow: ["/chat/", "/api/", "/sign-in", "/sign-up"],
      },
    ],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
