import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["playwright", "playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/dashboard": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
