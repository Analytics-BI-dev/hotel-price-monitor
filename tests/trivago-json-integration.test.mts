import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { searchPricing } from "../src/services/pricing/pricing-service.ts";
import { trivagoHotelConfigs } from "../src/providers/pricing/trivago/hotel-configs.ts";
import { CuriExecutiveOfficialProvider } from "../src/providers/pricing/official-sites/curi-executive.ts";
import { CuriPalaceOfficialProvider } from "../src/providers/pricing/official-sites/curi-palace.ts";
import { IbisPelotasOfficialProvider } from "../src/providers/pricing/official-sites/ibis-pelotas.ts";
import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { UnconfiguredPricingProvider } from "../src/providers/pricing/unconfigured-pricing-provider.ts";
import { createTrivagoJsonProviderMap } from "../src/providers/pricing/trivago/trivago-json-provider.ts";
import { TrivagoJsonRepository } from "../src/providers/pricing/trivago/trivago-json-repository.ts";
import { addDays, getStayDates } from "../src/services/pricing/validation.ts";
import type { PricingHotel, SourceResult, ValidatedPricingSearch } from "../src/types/pricing.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/trivago-daily.json", import.meta.url), "utf8"));
const params: ValidatedPricingSearch = { checkIn: "2026-09-11", checkOut: "2026-09-21", adults: 2, nights: 10, rooms: 1, children: 0 };
const hotels: PricingHotel[] = trivagoHotelConfigs.map((config, i) => ({
  id: `fixture-${i}`, slug: config.hotelSlug, name: config.hotelName, is_reference_hotel: i === 0,
  official_site_enabled: i !== 4, official_site_url: null, trivago_enabled: true, trivago_property_id: config.propertyId,
}));

test("serviço do dashboard: 7 hotéis/10 diárias fazem 1 download, nova busca atualiza e buscas simultâneas são isoladas", async (t) => {
  const previousUrl = process.env.TRIVAGO_JSON_URL;
  process.env.TRIVAGO_JSON_URL = "https://fixture.invalid/daily.json?token=DO_NOT_LOG";
  t.after(() => { if (previousUrl === undefined) delete process.env.TRIVAGO_JSON_URL; else process.env.TRIVAGO_JSON_URL = previousUrl; });
  const logs = t.mock.method(console, "info", () => undefined);
  t.mock.method(console, "warn", () => undefined);
  let downloads = 0;
  let offset = 0;
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    assert.equal(url, process.env.TRIVAGO_JSON_URL, "Nenhuma URL de pesquisa pode ser acessada pelo Trivago");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "follow");
    downloads++;
    return Response.json(fixture.map((row: Record<string, unknown>) => ({ ...row, Preco_Num: typeof row.Preco_Num === "number" ? row.Preco_Num + offset : row.Preco_Num })));
  });
  // The real registry must continue routing each official hotel to its existing
  // class. Official network/parsers are covered by their unchanged test suites.
  const officialResults = new Map<string, SourceResult>();
  const officialCalls: string[] = [];
  for (const [Provider, price] of [[CuriExecutiveOfficialProvider, 350], [CuriPalaceOfficialProvider, 400], [IbisPelotasOfficialProvider, 410]] as const) {
    t.mock.method(Provider.prototype, "search", async (input: ValidatedPricingSearch, hotel: PricingHotel) => {
      officialCalls.push(hotel.slug);
      const result: SourceResult = { source: "official_site", status: "success", bestPrice: price, bestProvider: "Site oficial", searchUrl: "https://official.invalid/", offers: [] };
      officialResults.set(hotel.slug, result);
      return getStayDates(input.checkIn, input.nights).map((date) => ({ date, result }));
    });
  }
  const first = await searchPricing(params, hotels);
  assert.equal(downloads, 1);
  assert.equal(first.days.length, 10);
  assert.ok(first.days.every((day) => day.hotels.length === 7));
  assert.equal(first.days[0].hotels[0].trivago.bestPrice, 289);
  assert.equal(first.days[0].hotels[1].comparisonBySource.trivago?.differenceValue, 31);
  assert.equal(first.days[0].hotels[1].comparisonBySource.official_site?.differenceValue, 50);
  assert.ok(first.days.slice(1).every((day) => day.hotels.every((hotel) => hotel.trivago.status === "unavailable")));
  assert.deepEqual(officialCalls.sort(), ["hotel-curi-executive", "curi-palace-hotel", "ibis-pelotas"].sort());
  for (const day of first.days) for (const hotel of day.hotels) {
    if (officialResults.has(hotel.hotelSlug)) assert.deepEqual(hotel.officialSite, officialResults.get(hotel.hotelSlug));
    else if (hotel.hotelSlug !== "jacques-georges-business") assert.equal(hotel.officialSite.status, "link_only");
  }
  offset = 100;
  const second = await searchPricing(params, hotels);
  assert.equal(downloads, 2);
  assert.equal(second.days[0].hotels[0].trivago.bestPrice, 389);
  await Promise.all([searchPricing(params, hotels), searchPricing(params, hotels)]);
  assert.equal(downloads, 4);
  assert.equal(requests.length, 4);
  const events = logs.mock.calls.map((call) => JSON.parse(call.arguments[0]));
  assert.equal(events.filter((event) => event.event === "TRIVAGO_JSON_FETCH_SUCCESS").length, 4);
  assert.equal(events.filter((event) => event.event === "TRIVAGO_JSON_LOOKUP").length, 280);
  assert.equal(JSON.stringify(events).includes("DO_NOT_LOG"), false);
  assert.equal(JSON.stringify(second).includes("DO_NOT_LOG"), false);
});

test("JSON success/unavailable/error preserva o resultado do provider HBook atual", async () => {
  const input = { ...params, nights: 1, checkOut: addDays(params.checkIn, 1) };
  const official = new CuriExecutiveOfficialProvider({ fetcher: async (_, init) => {
    if (init?.method !== "POST") return new Response('<input id="availabilityToken" value="test-token">');
    return Response.json({ HasErrors: false, Rooms: [{ Availability: 2, RoomTypeId: "standard", RoomTypeName: "Standard", Rates: [{ RateTypeId: "flex", RateTypeName: "Flexível", DailyPrice: 350, TotalValue: 350, PerDayRates: [{ Date: `${params.checkIn}T00:00:00Z`, Rate: 350 }] }] }] });
  } });
  const expected = (await official.search(input, hotels[0]))[0].result;
  assert.equal(expected.status, "success");
  for (const [data, status] of [[fixture, "success"], [[], "unavailable"], [{ invalid: true }, "error"]] as const) {
    const hybrid = new HybridPricingProvider(new UnconfiguredPricingProvider(), new Map([[official.hotelSlug, official]]),
      createTrivagoJsonProviderMap(trivagoHotelConfigs, new TrivagoJsonRepository({ url: "https://fixture.invalid/", fetcher: async () => Response.json(data) })));
    const [day] = await hybrid.search(input, [hotels[0]]);
    assert.deepEqual(day.hotels[0].officialSite, expected);
    assert.equal(day.hotels[0].trivago.status, status);
  }
});
