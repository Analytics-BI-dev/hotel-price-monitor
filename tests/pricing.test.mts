import assert from "node:assert/strict";
import test from "node:test";

import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import {
  buildPricingResult,
  getCompetitivePrice,
} from "../src/services/pricing/calculations.ts";
import {
  MAXIMUM_NIGHTS_MESSAGE,
  validatePricingSearch,
} from "../src/services/pricing/validation.ts";
import type {
  PricingHotel,
  SourceResult,
  ValidatedPricingSearch,
} from "../src/types/pricing.ts";

const hotels: PricingHotel[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Hotel Curi Executive",
    slug: "hotel-curi-executive",
    is_reference_hotel: true,
    official_site_enabled: true,
    official_site_url: "https://www.hotelcuri.com.br/",
    trivago_enabled: true,
    trivago_property_id: "2436946",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Hotel Alles Blau",
    slug: "hotel-alles-blau",
    is_reference_hotel: false,
    official_site_enabled: true,
    official_site_url: "https://www.hotelallesblau.com.br/#reserva",
    trivago_enabled: true,
    trivago_property_id: "7770070",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Hotel Jacques Georges Business",
    slug: "jacques-georges-business",
    is_reference_hotel: false,
    official_site_enabled: false,
    official_site_url: null,
    trivago_enabled: true,
    trivago_property_id: "3487706",
  },
];

function input(checkOut: string, adults: 1 | 2 = 1) {
  return {
    checkIn: "2026-09-10",
    checkOut,
    adults,
    rooms: 1 as const,
    children: 0 as const,
  };
}

test("aceita estadias de 1 e 10 diárias e bloqueia 11", () => {
  const oneNight = validatePricingSearch(input("2026-09-11"), "2026-09-01");
  const tenNights = validatePricingSearch(input("2026-09-20"), "2026-09-01");
  const elevenNights = validatePricingSearch(input("2026-09-21"), "2026-09-01");

  assert.equal(oneNight.success, true);
  assert.equal(oneNight.success && oneNight.data.nights, 1);
  assert.equal(tenNights.success, true);
  assert.equal(tenNights.success && tenNights.data.nights, 10);
  assert.deepEqual(elevenNights, {
    success: false,
    message: MAXIMUM_NIGHTS_MESSAGE,
  });
});

test("aceita apenas 1 ou 2 adultos", () => {
  assert.equal(validatePricingSearch(input("2026-09-11", 1), "2026-09-01").success, true);
  assert.equal(validatePricingSearch(input("2026-09-11", 2), "2026-09-01").success, true);
  assert.equal(
    validatePricingSearch({ ...input("2026-09-11"), adults: 3 }, "2026-09-01").success,
    false,
  );
});

test("provider mock é determinístico e varia preços por ocupação", async () => {
  const provider = new MockPricingProvider();
  const oneAdult: ValidatedPricingSearch = { ...input("2026-09-12", 1), nights: 2 };
  const twoAdults: ValidatedPricingSearch = { ...input("2026-09-12", 2), nights: 2 };

  const first = await provider.search(oneAdult, hotels);
  const repeated = await provider.search(oneAdult, hotels);
  const occupied = await provider.search(twoAdults, hotels);

  assert.deepEqual(first, repeated);
  assert.notEqual(
    first[0].hotels[0].officialSite.bestPrice,
    occupied[0].hotels[0].officialSite.bestPrice,
  );
  assert.notEqual(
    first[0].hotels[0].officialSite.bestPrice,
    first[1].hotels[0].officialSite.bestPrice,
  );
  assert.equal(first.length, 2);
  assert.deepEqual(
    first[0].hotels.map((hotel) => hotel.hotelName),
    hotels.map((hotel) => hotel.name),
  );
  assert.ok(
    first.flatMap((day) => day.hotels).every((hotel) =>
      [...hotel.officialSite.offers, ...hotel.trivago.offers].every(
        (offer) => offer.price >= 220 && offer.price <= 650,
      ),
    ),
  );
});

test("Jacques Georges Business não cria preço oficial e mantém Trivago", async () => {
  const provider = new MockPricingProvider();
  const params: ValidatedPricingSearch = { ...input("2026-09-11"), nights: 1 };
  const [day] = await provider.search(params, hotels);
  const business = day.hotels.find(
    (hotel) => hotel.hotelSlug === "jacques-georges-business",
  );

  assert.equal(business?.officialSite.status, "unavailable");
  assert.equal(business?.officialSite.bestPrice, null);
  assert.deepEqual(business?.officialSite.offers, []);
  assert.equal(business?.trivago.status, "success");
  assert.ok((business?.trivago.bestPrice ?? 0) > 0);
});

test("competitivePrice usa o menor preço válido e nunca converte ausência em zero", () => {
  const source = (bestPrice: number | null): SourceResult => ({
    source: "official_site",
    status: bestPrice === null ? "unavailable" : "success",
    bestPrice,
    bestProvider: null,
    searchUrl: null,
    offers: [],
  });

  assert.equal(getCompetitivePrice(source(340), { ...source(315), source: "trivago" }), 315);
  assert.equal(getCompetitivePrice(source(null), { ...source(327), source: "trivago" }), 327);
  assert.equal(getCompetitivePrice(source(null), { ...source(null), source: "trivago" }), null);
});

test("comparativo e gráfico usam o Curi e o concorrente mais barato do mesmo dia", async () => {
  const provider = new MockPricingProvider();
  const params: ValidatedPricingSearch = { ...input("2026-09-11"), nights: 1 };
  const providerDays = await provider.search(params, hotels);
  const result = buildPricingResult(params, providerDays);
  const [day] = result.days;
  const reference = day.hotels[0];
  const competitor = day.hotels[1];
  const cheapest = day.hotels
    .slice(1)
    .filter((hotel) => hotel.competitivePrice !== null)
    .sort((left, right) =>
      (left.competitivePrice as number) - (right.competitivePrice as number),
    )[0];

  assert.equal(reference.isReferenceHotel, true);
  assert.deepEqual(reference.comparisonBySource, { official_site: null, trivago: null });
  assert.equal(
    competitor.comparisonBySource.official_site?.differenceValue,
    (competitor.officialSite.bestPrice as number) - (reference.officialSite.bestPrice as number),
  );
  assert.equal(
    competitor.comparisonBySource.trivago?.differenceValue,
    (competitor.trivago.bestPrice as number) - (reference.trivago.bestPrice as number),
  );
  assert.equal(result.strategy[0].cheapestCompetitorName, cheapest.hotelName);
  assert.equal(
    result.strategy[0].differenceValue,
    (reference.competitivePrice as number) - (cheapest.competitivePrice as number),
  );
});

test("comparações não misturam fontes mesmo quando o menor preço vem de outra fonte", async () => {
  const params: ValidatedPricingSearch = { ...input("2026-09-11"), nights: 1 };
  const days = await new MockPricingProvider().search(params, hotels);
  const reference = days[0].hotels[0];
  const competitor = days[0].hotels[1];
  reference.officialSite.bestPrice = 400;
  reference.trivago.bestPrice = 250;
  competitor.officialSite.bestPrice = 350;
  competitor.trivago.bestPrice = 300;
  let result = buildPricingResult(params, days);
  assert.deepEqual(result.days[0].hotels[1].comparisonBySource, {
    official_site: { differenceValue: -50, differencePercent: -12.5 },
    trivago: { differenceValue: 50, differencePercent: 20 },
  });
  assert.equal(result.days[0].hotels[1].competitivePrice, 300);

  competitor.officialSite = {
    ...competitor.officialSite, status: "link_only", bestPrice: null, offers: [],
  };
  result = buildPricingResult(params, days);
  assert.equal(result.days[0].hotels[1].comparisonBySource.official_site, null);
  assert.equal(result.days[0].hotels[1].comparisonBySource.trivago?.differenceValue, 50);
  assert.equal(result.days[0].hotels[1].competitivePrice, 300);

  reference.trivago.status = "error";
  result = buildPricingResult(params, days);
  assert.equal(result.days[0].hotels[1].comparisonBySource.trivago, null);
  assert.equal(result.days[0].hotels[0].competitivePrice, 400);
});
