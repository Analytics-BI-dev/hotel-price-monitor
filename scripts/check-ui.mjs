// Local UI regression checks: real components, fixture actions, no Supabase or provider requests.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "test-results", "ui-audit");
const modules = new Map();
const mocks = {
  "@/app/actions/pricing": `exports.searchPricesAction = async (data) => {
    window.__ui.searchCalls.push(Object.fromEntries(data));
    return await new Promise((resolve, reject) => {
      window.__ui.resolveSearch = resolve;
      window.__ui.rejectSearch = () => reject(new Error('Fixture network failure'));
    });
  };`,
  "@/app/actions/users": `
    exports.resetUserPasswordAction = async () => {
      window.__ui.resetCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 40));
      return { status: 'success', message: 'Senha atualizada com sucesso.' };
    };
    exports.createUserAction = async () => {
      window.__ui.createCalls += 1;
      return { status: 'success', message: 'Usuário criado com sucesso.' };
    };`,
  "next/navigation": `exports.unstable_rethrow = error => {
    if (error?.digest?.startsWith('NEXT_REDIRECT')) throw error;
  };`,
};

async function bundleModule(filename, sourceOverride) {
  if (modules.has(filename)) return filename;
  modules.set(filename, null);
  const source = sourceOverride ?? await readFile(filename, "utf8");
  const code = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const dependencies = {};

  for (const match of code.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
    const request = match[1];
    if (Object.hasOwn(mocks, request)) {
      dependencies[request] = await bundleModule(`fixture:${request}`, mocks[request]);
    } else if (request.startsWith("@/")) {
      assert.match(request, /^@\/(components\/|services\/pricing\/(validation|calculations)$)/);
      const base = path.join(projectRoot, "src", request.slice(2));
      let resolved;
      for (const extension of [".ts", ".tsx"]) {
        try {
          await readFile(`${base}${extension}`);
          resolved = `${base}${extension}`;
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      assert.ok(resolved, `Unable to resolve UI module: ${request}`);
      dependencies[request] = await bundleModule(resolved);
    } else {
      const require = createRequire(filename.startsWith("fixture:") ? import.meta.url : filename);
      dependencies[request] = await bundleModule(require.resolve(request));
    }
  }

  modules.set(filename, { code, dependencies });
  return filename;
}

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PricingDashboard } from '@/components/pricing/pricing-dashboard';
import { DailyResults } from '@/components/pricing/daily-results';
import { StrategyChart } from '@/components/pricing/strategy-chart';
import { ResetPasswordModal } from '@/components/admin/reset-password-modal';
import { CreateUserForm } from '@/components/admin/create-user-form';
import { buildPricingResult } from '@/services/pricing/calculations';

function source(kind, price, count = 2) {
  return {
    source: kind, status: 'success', bestPrice: price, bestProvider: kind === 'trivago' ? 'Agoda' : null,
    searchUrl: 'https://example.invalid/search',
    offers: Array.from({length: count}, (_, index) => ({
      id: kind + index, source: kind, providerName: ['Agoda', 'Booking.com', 'Hoteis.com'][index],
      roomName: 'Quarto confortável', rateName: 'Tarifa flexível', detailsText: 'Informação não disponível',
      breakfastIncluded: true, refundable: true, price: price + index * 10, currency: 'BRL',
    })),
  };
}
const params = { checkIn: '2027-01-30', checkOut: '2027-01-31', adults: 1, rooms: 1, children: 0, nights: 1 };
const hotels = [
  { hotelId: 'curi', hotelName: 'Hotel Curi Executive', hotelSlug: 'curi', isReferenceHotel: true, date: params.checkIn, officialSite: source('official_site', 300), trivago: source('trivago', 240) },
  { hotelId: 'competitor', hotelName: 'Concorrente de teste', hotelSlug: 'competitor', isReferenceHotel: false, date: params.checkIn, officialSite: source('official_site', 330), trivago: source('trivago', 216, 3) },
  { hotelId: 'equal', hotelName: 'Hotel de preço igual', hotelSlug: 'equal', isReferenceHotel: false, date: params.checkIn, officialSite: source('official_site', 300), trivago: source('trivago', 240) },
  { hotelId: 'link', hotelName: 'Hotel somente link', hotelSlug: 'link', isReferenceHotel: false, date: params.checkIn, officialSite: {source: 'official_site', status: 'link_only', bestPrice: null, bestProvider: null, searchUrl: 'https://example.invalid/reservation', offers: []}, trivago: source('trivago', 270) },
];
const result = buildPricingResult(params, [{date: params.checkIn, checkoutDate: params.checkOut, hotels}]);
window.__ui = { searchCalls: [], resetCalls: 0, createCalls: 0, result };
createRoot(document.getElementById('root')).render(
  <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
    <h1 className="text-2xl font-bold">Verificação local da interface</h1>
    <section aria-label="Formulário de teste"><PricingDashboard initialCheckIn={params.checkIn} initialCheckOut={params.checkOut} /></section>
    <section aria-label="Resultados de teste"><DailyResults days={result.days} /></section>
    <StrategyChart points={result.strategy} summary={result.summary} />
    <section aria-label="Administração de teste" className="space-y-4 rounded-xl bg-white p-5">
      <ResetPasswordModal userId="00000000-0000-4000-8000-000000000001" name="Usuário de teste" username="fixture@example.invalid" />
      <CreateUserForm />
    </section>
  </main>
);
`;

const entryId = await bundleModule(path.join(projectRoot, "scripts", "ui-fixture.tsx"), entry);
const bundle = `(() => {
  const process = { env: { NODE_ENV: 'development' } };
  const modules = {${[...modules].map(([id, module]) => `${JSON.stringify(id)}: [function(module, exports, require) {\n${module.code}\n}, ${JSON.stringify(module.dependencies)}]`).join(",\n")}};
  const cache = {};
  function load(id) {
    if (cache[id]) return cache[id].exports;
    const module = cache[id] = { exports: {} };
    const [factory, dependencies] = modules[id];
    factory(module, module.exports, request => load(dependencies[request]));
    return module.exports;
  }
  load(${JSON.stringify(entryId)});
})();`;
const css = (await postcss([tailwind({ base: projectRoot })]).process(
  await readFile(path.join(projectRoot, "src", "app", "globals.css"), "utf8"),
  { from: path.join(projectRoot, "src", "app", "globals.css") },
)).css;

const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/bundle.js") {
    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
    response.end(bundle);
  } else if (request.url === "/style.css") {
    response.setHeader("Content-Type", "text/css; charset=utf-8");
    response.end(css);
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local UI checks</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const localUrl = `http://127.0.0.1:${address.port}`;
let browser;
const checks = [];
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const pageErrors = [];
  const unexpectedRequests = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === localUrl) return route.continue();
    unexpectedRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  await page.goto(localUrl);
  await page.getByRole("heading", { name: "Verificação local da interface" }).waitFor();
  const results = page.getByRole("region", { name: "Resultados de teste" });
  const competitor = results.locator("article").filter({ hasText: "Concorrente de teste" });
  const expand = competitor.getByRole("button", { name: "Ver ofertas de Concorrente de teste" });
  assert.equal(await expand.getAttribute("aria-expanded"), "false");
  await expand.focus();
  await page.keyboard.press("Enter");
  assert.equal(await expand.getAttribute("aria-expanded"), "true");
  assert.equal(await competitor.locator("summary a, summary button, button a").count(), 0);
  const trivia = competitor.locator("section").filter({ has: page.getByRole("heading", { name: "Trivago", exact: true }) });
  assert.equal(await trivia.locator("li").count(), 3);
  assert.doesNotMatch(await trivia.innerText(), /Informação não disponível|Café|Reembolsável|Tarifa flexível|Quarto confortável/);
  assert.equal(await competitor.locator(".text-emerald-700[title]").count(), 1);
  assert.equal(await competitor.locator(".text-red-700[title]").count(), 1);
  for (const hotelName of ["Hotel Curi Executive", "Hotel de preço igual"]) {
    assert.equal(await results.locator("article").filter({ hasText: hotelName }).locator("span[title]").count(), 0);
  }
  const linkOnly = results.locator("article").filter({ hasText: "Hotel somente link" });
  assert.equal(await linkOnly.getByRole("link", { name: "Abrir pesquisa no site oficial em nova aba" }).count(), 1);
  assert.doesNotMatch(await linkOnly.innerText(), /Indisponível|Erro/);
  const curi = results.locator("article").filter({ hasText: "Hotel Curi Executive" });
  await curi.getByRole("button").click();
  assert.equal(await curi.locator("section").filter({ has: page.getByRole("heading", { name: "Trivago", exact: true }) }).locator("li").count(), 2);
  checks.push("accordion_keyboard_links_source_comparisons_trivago_2_and_3_offers");

  const formRegion = page.getByRole("region", { name: "Formulário de teste" });
  const searchForm = formRegion.locator("form");
  const controls = [searchForm.locator('[name="checkIn"]'), searchForm.locator('[name="checkOut"]'), searchForm.getByRole("button", { name: "1", exact: true }), searchForm.getByRole("button", { name: "Buscar preços", exact: true })];
  const bottoms = await Promise.all(controls.map(async control => {
    const box = await control.boundingBox();
    assert.ok(box);
    return box.y + box.height;
  }));
  assert.ok(Math.max(...bottoms) - Math.min(...bottoms) <= 2, `Controls misaligned: ${bottoms.join(", ")}`);
  await searchForm.evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await page.waitForFunction(() => window.__ui.searchCalls.length === 1);
  assert.equal(await searchForm.getAttribute("aria-busy"), "true");
  for (const control of controls) assert.equal(await control.isDisabled(), true);
  await page.evaluate(() => window.__ui.rejectSearch());
  await formRegion.getByRole("alert").filter({ hasText: "Verifique sua conexão" }).waitFor();
  await formRegion.getByRole("button", { name: "Buscar preços", exact: true }).click();
  await page.waitForFunction(() => window.__ui.searchCalls.length === 2);
  await page.evaluate(() => window.__ui.resolveSearch({ status: "success", message: "OK", result: window.__ui.result }));
  await formRegion.getByRole("heading", { name: "Curi x concorrente mais barato" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__ui.searchCalls.map(call => call.adults)), ["1", "1"]);
  checks.push("aligned_controls_duplicate_submit_disabled_network_error_recovery");

  const admin = page.getByRole("region", { name: "Administração de teste" });
  const trigger = admin.getByRole("button", { name: "Redefinir senha", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("Nova senha", { exact: true }).evaluate(input => input === document.activeElement), true);
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
  await trigger.click();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await dialog.getByLabel("Nova senha", { exact: true }).fill("local-fixture-only");
    await dialog.getByLabel("Confirmar nova senha", { exact: true }).fill("local-fixture-only");
    await dialog.getByRole("button", { name: "Salvar nova senha" }).click();
    await page.waitForFunction(expected => window.__ui.resetCalls === expected, attempt);
    await page.waitForFunction(() => [...document.querySelectorAll("dialog input[type=password]")].every(input => input.value === ""));
  }
  await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
  checks.push("native_dialog_focus_trap_escape_focus_restore_consecutive_resets");

  const chart = page.getByRole("group", { name: "Gráfico de diferenças diárias" }).last();
  await chart.getByRole("button").first().focus();
  const tooltipId = await chart.getByRole("button").first().getAttribute("aria-describedby");
  assert.ok(tooltipId);
  assert.equal(await page.getByRole("tooltip").last().getAttribute("id"), tooltipId);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("tooltip").count(), 0);
  checks.push("chart_keyboard_tooltip_association_escape");

  await mkdir(outputDirectory, { recursive: true });
  await page.screenshot({ path: path.join(outputDirectory, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(outputDirectory, "mobile.png"), fullPage: true });
  checks.push("desktop_1440_mobile_390_no_page_overflow");
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ status: "success", checks, externalRequests: 0, browserErrors: 0, screenshots: outputDirectory }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
