import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/dashboard": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      // Playwright loads some internal modules dynamically. Their presence at
      // build time does not guarantee Next's automatic trace will include them.
      "./node_modules/playwright-core/**/*",
    ],
  },
};

export default nextConfig;
