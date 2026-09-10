import assert from "node:assert/strict";
import test from "node:test";
import type { Browser, LaunchOptions } from "playwright";
import { createTrivagoBrowserLauncher, TrivagoBrowserError, usesServerlessChromium } from "../src/providers/pricing/trivago/browser.ts";

test("Vercel production e preview usam serverless; local e vercel dev não", () => {
  assert.equal(usesServerlessChromium({}), false);
  assert.equal(usesServerlessChromium({ VERCEL: "0" }), false);
  assert.equal(usesServerlessChromium({ VERCEL: "1" }), true);
  assert.equal(usesServerlessChromium({ VERCEL: "1", VERCEL_ENV: "production" }), true);
  assert.equal(usesServerlessChromium({ VERCEL: "1", VERCEL_ENV: "preview" }), true);
  assert.equal(usesServerlessChromium({ VERCEL: "1", VERCEL_ENV: "development" }), false);
});

test("local mantém o navegador Playwright sem carregar o binário Linux", async () => {
  let received: LaunchOptions | undefined;
  const browser = {} as Browser;
  const launch = createTrivagoBrowserLauncher({
    launch: async (options) => { received = options; return browser; },
    serverless: async () => { throw new Error("não deve carregar"); },
  });
  assert.equal(await launch({}), browser);
  assert.deepEqual(received, { headless: true, timeout: 30_000 });
});

test("serverless extrai uma vez, mas cria browsers separados em chamadas concorrentes", async () => {
  let extractions = 0;
  const options: LaunchOptions[] = [];
  const launch = createTrivagoBrowserLauncher({
    launch: async (value) => { options.push(value); return {} as Browser; },
    serverless: async () => ({
      args: ["--test-serverless-argument", "--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials"],
      executablePath: async () => { extractions++; return "/tmp/chromium"; },
    }),
  });
  const [first, second] = await Promise.all([launch({ VERCEL: "1" }), launch({ VERCEL: "1" })]);
  assert.notEqual(first, second);
  assert.equal(extractions, 1);
  assert.equal(options.length, 2);
  for (const value of options) {
    assert.equal(value.executablePath, "/tmp/chromium");
    assert.deepEqual(value.args, ["--test-serverless-argument"]);
  }
});

test("falha de extração não fica memorizada e erro não expõe diagnóstico bruto", async () => {
  let calls = 0;
  const launch = createTrivagoBrowserLauncher({
    launch: async () => ({} as Browser),
    serverless: async () => ({
      args: [],
      executablePath: async () => {
        if (++calls === 1) throw new Error("raw-private-diagnostic");
        return "/tmp/chromium";
      },
    }),
  });
  await assert.rejects(launch({ VERCEL: "1" }), (error: unknown) => {
    assert.ok(error instanceof TrivagoBrowserError);
    assert.equal(error.category, "browser_launch_error");
    assert.ok(!error.message.includes("raw-private"));
    return true;
  });
  await launch({ VERCEL: "1" });
  assert.equal(calls, 2);
});

test("navegador ausente tem categoria específica", async () => {
  const launch = createTrivagoBrowserLauncher({
    launch: async () => { throw new Error("Executable doesn't exist at private/path"); },
    serverless: async () => { throw new Error("não deve carregar"); },
  });
  await assert.rejects(launch({}), (error: unknown) => {
    assert.ok(error instanceof TrivagoBrowserError);
    assert.equal(error.category, "browser_not_installed");
    assert.ok(!error.message.includes("private/path"));
    return true;
  });
});
