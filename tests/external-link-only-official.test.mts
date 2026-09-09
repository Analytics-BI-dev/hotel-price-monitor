import assert from "node:assert/strict";
import test from "node:test";

import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import {
  buildExternalOfficialSearchUrl,
  externalLinkOnlyOfficialHotelConfigs,
  ExternalLinkOnlyOfficialProvider,
} from "../src/providers/pricing/official-sites/external-link-only.ts";
import type {
  OfficialSitePricingProvider,
  TrivagoPricingSourceProvider,
} from "../src/providers/pricing/types.ts";
import { buildPricingResult } from "../src/services/pricing/calculations.ts";
import type {
  PricingHotel,
  ValidatedPricingSearch,
} from "../src/types/pricing.ts";

const params: ValidatedPricingSearch = {
  checkIn: "2026-08-31",
  checkOut: "2026-09-01",
  adults: 1,
  rooms: 1,
  children: 0,
  nights: 1,
};

const expectedUrls = new Map([
  [
    "hotel-alles-blau",
    "https://reservas.desbravador.com.br/hotel-app/hotel-alles-blau/reservation?checkin=2026-08-31&checkout=2026-09-01&adults=1&child1=0&child2=0&child3=0&voucher=&resident=0",
  ],
  [
    "jacques-georges-tower",
    "https://reservas.desbravador.com.br/hotel-app/hotel-jacques-georges-tower/reservation?checkin=2026-08-31&checkout=2026-09-01&adults=1&child1=0&child2=0&child3=0&voucher=&resident=0",
  ],
  [
    "m-tower-hotel",
    "https://reservas.desbravador.com.br/hotel-app/m-tower-hotel/reservation?checkin=2026-08-31&checkout=2026-09-01&adults=1&child1=0&child2=0&child3=0&voucher=&resident=0",
  ],
]);

function hotelFor(
  config: (typeof externalLinkOnlyOfficialHotelConfigs)[number],
): PricingHotel {
  return {
    id: `test-${config.hotelSlug}`,
    name: config.hotelSlug,
    slug: config.hotelSlug,
    is_reference_hotel: false,
    official_site_enabled: true,
    official_site_url: config.reservationBaseUrl,
    trivago_enabled: true,
    trivago_property_id: `property-${config.hotelSlug}`,
  };
}

test("gera os três links Desbravador exatos sem misturar hotéis ou parâmetros", () => {
  assert.equal(externalLinkOnlyOfficialHotelConfigs.length, 3);

  for (const config of externalLinkOnlyOfficialHotelConfigs) {
    assert.equal(
      buildExternalOfficialSearchUrl(config, params),
      expectedUrls.get(config.hotelSlug),
    );
  }
});

test("provider retorna somente URL sem preço, oferta ou chamada de rede", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Acesso de rede inesperado");
  }) as typeof fetch;

  try {
    for (const config of externalLinkOnlyOfficialHotelConfigs) {
      const provider = new ExternalLinkOnlyOfficialProvider(config);
      const [day] = await provider.search(params, hotelFor(config));

      assert.equal(day.result.status, "link_only");
      assert.equal(day.result.bestPrice, null);
      assert.equal(day.result.bestProvider, null);
      assert.deepEqual(day.result.offers, []);
      assert.equal(day.result.searchUrl, expectedUrls.get(config.hotelSlug));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
});

test("composição usa somente o Trivago como competitivePrice nos três hotéis", async () => {
  const hotels = externalLinkOnlyOfficialHotelConfigs.map(hotelFor);
  const officialProviders = new Map<string, OfficialSitePricingProvider>(
    externalLinkOnlyOfficialHotelConfigs.map((config) => {
      const provider = new ExternalLinkOnlyOfficialProvider(config);
      return [provider.hotelSlug, provider];
    }),
  );
  const expectedPrices = new Map(
    hotels.map((hotel, index) => [hotel.slug, 281 + index]),
  );
  const trivagoProviders = new Map<string, TrivagoPricingSourceProvider>(
    hotels.map((hotel) => [
      hotel.slug,
      {
        hotelSlug: hotel.slug,
        async search() {
          const bestPrice = expectedPrices.get(hotel.slug) as number;
          return [
            {
              date: params.checkIn,
              result: {
                source: "trivago" as const,
                status: "success" as const,
                bestPrice,
                bestProvider: "Agoda",
                searchUrl: `https://www.trivago.com.br/${hotel.slug}`,
                offers: [],
              },
            },
          ];
        },
      },
    ]),
  );
  const hybrid = new HybridPricingProvider(
    new MockPricingProvider(),
    officialProviders,
    trivagoProviders,
  );
  const result = buildPricingResult(
    params,
    await hybrid.search(params, hotels),
  );

  for (const hotel of result.days[0].hotels) {
    assert.equal(hotel.officialSite.bestPrice, null);
    assert.deepEqual(hotel.officialSite.offers, []);
    assert.equal(hotel.trivago.bestPrice, expectedPrices.get(hotel.hotelSlug));
    assert.equal(hotel.competitivePrice, expectedPrices.get(hotel.hotelSlug));
  }
});
