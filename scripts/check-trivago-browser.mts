import assert from "node:assert/strict";
import { launchTrivagoBrowser, TrivagoBrowserError, usesServerlessChromium } from "../src/providers/pricing/trivago/browser.ts";

// Offline smoke test of the actual launcher: no credentials or external pages.
try {
  const browser = await launchTrivagoBrowser();
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.setContent("<title>Trivago browser smoke</title><p>OK</p>");
      assert.equal(await page.title(), "Trivago browser smoke");
      console.info(JSON.stringify({
        event: "TRIVAGO_BROWSER_SMOKE_SUCCESS",
        runtime: usesServerlessChromium({ VERCEL: process.env.VERCEL, VERCEL_ENV: process.env.VERCEL_ENV }) ? "serverless" : "local",
        browserVersion: browser.version(),
      }));
    } finally { await context.close(); }
  } finally { await browser.close(); }
} catch (error) {
  console.error(JSON.stringify({
    event: "TRIVAGO_BROWSER_SMOKE_ERROR",
    category: error instanceof TrivagoBrowserError ? error.category : "browser_smoke_error",
  }));
  process.exitCode = 1;
}
