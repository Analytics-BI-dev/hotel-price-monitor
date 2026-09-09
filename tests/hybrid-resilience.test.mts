import assert from "node:assert/strict";
import test from "node:test";
import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { UnconfiguredPricingProvider } from "../src/providers/pricing/unconfigured-pricing-provider.ts";
import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import { logPricing } from "../src/services/pricing/logger.ts";
import type { PricingHotel, SourceResult, ValidatedPricingSearch } from "../src/types/pricing.ts";

const params: ValidatedPricingSearch = {
  checkIn: "2026-09-10", checkOut: "2026-09-12", nights: 2,
  adults: 1, rooms: 1, children: 0,
};
const hotel: PricingHotel = {
  id: "test-hotel", name: "Hotel Curi Executive", slug: "hotel-curi-executive",
  is_reference_hotel: true, official_site_enabled: true, official_site_url: null,
  trivago_enabled: true, trivago_property_id: "2436946",
};
const valid: SourceResult = {
  source: "trivago", status: "success", bestPrice: 249, bestProvider: "Agoda",
  searchUrl: "https://www.trivago.com.br/", offers: [],
};

test("uma fonte que lança erro não derruba a outra e não retorna preço mock", async () => {
  const hybrid = new HybridPricingProvider(new UnconfiguredPricingProvider(),
    new Map([[hotel.slug, { hotelSlug: hotel.slug, async search() { throw new Error("test error"); } }]]),
    new Map([[hotel.slug, { hotelSlug: hotel.slug, async search() {
      return [{ date: params.checkIn, result: valid }];
    } }]]),
  );
  const days = await hybrid.search(params, [hotel]);
  assert.equal(days[0].hotels[0].officialSite.status, "error");
  assert.equal(days[0].hotels[0].officialSite.bestPrice, null);
  assert.deepEqual(days[0].hotels[0].trivago, valid);
  assert.equal(days[1].hotels[0].trivago.status, "error");
  assert.equal(days[1].hotels[0].trivago.bestPrice, null);
});

test("resposta parcial do provider substitui mock também nas diárias ausentes", async () => {
  const hybrid = new HybridPricingProvider(new MockPricingProvider(), new Map(),
    new Map([[hotel.slug, { hotelSlug: hotel.slug, async search() {
      return [{ date: params.checkIn, result: valid }];
    } }]]),
  );
  const days = await hybrid.search(params, [hotel]);
  assert.equal(days[0].hotels[0].trivago.bestPrice, 249);
  assert.equal(days[1].hotels[0].trivago.status, "error");
  assert.deepEqual(days[1].hotels[0].trivago.offers, []);
});

test("produção sem provider não cria preços e fonte desabilitada continua unavailable", async () => {
  const days = await new UnconfiguredPricingProvider().search(params, [
    hotel, { ...hotel, slug: "jacques-georges-business", official_site_enabled: false },
  ]);
  for (const day of days) for (const rate of day.hotels) {
    assert.equal(rate.officialSite.bestPrice, null);
    assert.equal(rate.trivago.bestPrice, null);
  }
  assert.equal(days[0].hotels[0].officialSite.status, "error");
  assert.equal(days[0].hotels[1].officialSite.status, "unavailable");
});

test("logs usam lista explícita de campos e não serializam dados extras", (t) => {
  const info = t.mock.method(console, "info", () => undefined);
  const context = {
    hotelSlug: hotel.slug, source: "trivago" as const,
    checkIn: params.checkIn, checkOut: params.checkOut, adults: 1, durationMs: 10,
    password: "DO_NOT_LOG", cookie: "DO_NOT_LOG", token: "DO_NOT_LOG",
    Authorization: "DO_NOT_LOG", secret: "DO_NOT_LOG", message: "DO_NOT_LOG",
  };
  logPricing("PRICING_PROVIDER_START", context);
  const output = String(info.mock.calls[0].arguments[0]);
  assert.equal(output.includes("DO_NOT_LOG"), false);
  assert.equal(JSON.parse(output).hotelSlug, hotel.slug);
});
