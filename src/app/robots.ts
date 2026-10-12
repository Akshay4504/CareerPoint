import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/jobs", "/professionals", "/companies", "/resources", "/tools", "/communities"],
        // Private areas, APIs and per-user pages never belong in a search index.
        disallow: ["/api/", "/admin", "/employer", "/dashboard", "/profile", "/resume", "/portfolio", "/applications", "/career-insights", "/notifications", "/settings", "/invite/", "/shared/", "/communities/join/", "/jobs/saved", "/jobs/alerts", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
