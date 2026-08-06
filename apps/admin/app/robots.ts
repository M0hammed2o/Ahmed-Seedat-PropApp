import type { MetadataRoute } from 'next';

// Super Admin separation, item 9 (WORKLOG.md this date): no sitemap.ts exists in this app (it's
// almost entirely an authenticated application, not a crawlable site -- confirmed before writing
// this, not assumed), so there's no sitemap entry to omit /platform-admin from in the first
// place. This file's actual job is the explicit Disallow rule -- belt-and-suspenders alongside
// proxy.ts's X-Robots-Tag header (for crawlers that fetch pages regardless of robots.txt) and the
// (super-admin) layout's own `robots` metadata (the <meta name="robots"> tag on the rendered
// page itself).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/platform-admin',
    },
  };
}
