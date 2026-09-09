import assert from "node:assert/strict";
import test from "node:test";

import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import {
  buildIbisPelotasSearchUrl,
  IbisPelotasOfficialProvider,
  parseIbisBrazilianPrice,
  parseIbisPelotasDailyAvailability,
} from "../src/providers/pricing/official-sites/ibis-pelotas.ts";
import type { OfficialSitePricingProvider } from "../src/providers/pricing/types.ts";
import type {
  PricingHotel,
  SourceResult,
  ValidatedPricingSearch,
} from "../src/types/pricing.ts";

const hotel: PricingHotel = {
  id: "00000000-0000-4000-8000-000000000006",
  name: "ibis Pelotas",
  slug: "ibis-pelotas",
  is_reference_hotel: false,
  official_site_enabled: true,
  official_site_url: "https://ibispelotas.atriohoteis.com.br/",
  trivago_enabled: true,
  trivago_property_id: "ibis-mock",
};

const params: ValidatedPricingSearch = {
  checkIn: "2026-09-01",
  checkOut: "2026-09-02",
  adults: 1,
  rooms: 1,
  children: 0,
  nights: 1,
};

const accorHtml = `
  <script>
    window.__NUXT__={};
    window.__NUXT__.config={public:{gqlApiKey:"public-test-key"}};
  </script>
`;

function offer({
  productId = "DBC",
  rateId = "1RB1",
  amount,
  tax,
  category,
  adults = 1,
  cancellationCode = "FREE_CANCELLATION",
}: {
  productId?: string;
  rateId?: string;
  amount: number | string;
  tax: string;
  category: "MEMBER_RATE" | "STANDARD";
  adults?: number;
  cancellationCode?: string;
}) {
  return {
    pricing: {
      currency: "BRL",
      aggregationType: "TOTAL_STAY",
      formattedTaxType: tax,
      main: {
        amount,
        categories: [category],
        simplifiedPolicies: {
          cancellation: {
            code: cancellationCode,
            label:
              cancellationCode === "FREE_CANCELLATION"
                ? "Cancelamento sem custo"
                : "Não reembolsável",
          },
        },
      },
    },
    mealPlan: { code: "BED_AND_BREAKFAST", label: "Café da manhã incluído" },
    lengthOfStay: { value: 1, unit: "NIGHT" },
    product: { id: productId, quantity: 1, updatedRemaining: 4 },
    rate: { id: rateId, label: "Tarifa flexível", legacyId: rateId },
    occupancy: { adults, childrenAges: [], babies: 0 },
  };
}

function availabilityPayload(
  memberAmount = 253.65,
  publicAmount = 267,
  adults = 1,
) {
  return {
    data: {
      hotel: {
        accommodations: [
          { code: "DBC", name: "Quarto Standard com 1 cama de casal" },
          { code: "TWC", name: "Quarto Standard com 2 camas de solteiro" },
        ],
      },
      memberOffers: {
        offersSelection: {
          offers: [
            offer({
              amount: memberAmount,
              tax: "Impostos não incluídos : R$ 12,68.",
              category: "MEMBER_RATE",
              adults,
            }),
          ],
        },
        availability: { status: "AVAILABLE", reasons: [] },
      },
      publicOffers: {
        offersSelection: {
          offers: [
            offer({
              amount: publicAmount,
              tax: "Impostos não incluídos : R$ 13,35.",
              category: "STANDARD",
              adults,
            }),
            offer({
              amount: "R$ 298,00",
              tax: "Impostos incluídos.",
              category: "STANDARD",
              productId: "TWC",
              adults,
            }),
          ],
        },
        availability: { status: "AVAILABLE", reasons: [] },
      },
    },
  };
}

test("normaliza valores brasileiros sem parseFloat direto", () => {
  assert.equal(parseIbisBrazilianPrice("R$ 298,00"), 298);
  assert.equal(parseIbisBrazilianPrice("R$ 1.298,50"), 1298.5);
  assert.equal(parseIbisBrazilianPrice(253.65), 253.65);
  assert.equal(parseIbisBrazilianPrice("—"), null);
});

test("searchUrl preserva datas, uma composição e 1 ou 2 adultos", () => {
  const oneAdult = new URL(buildIbisPelotasSearchUrl(params));
  const twoAdults = new URL(
    buildIbisPelotasSearchUrl({ ...params, adults: 2 }),
  );

  assert.equal(oneAdult.hostname, "all.accor.com");
  assert.equal(oneAdult.pathname, "/booking/pt-br/accor/hotel/B6N3");
  assert.equal(oneAdult.searchParams.get("dateIn"), "2026-09-01");
  assert.equal(oneAdult.searchParams.get("nights"), "1");
  assert.equal(oneAdult.searchParams.get("compositions"), "1");
  assert.equal(twoAdults.searchParams.get("compositions"), "2");
  assert.equal(oneAdult.searchParams.get("stayplus"), "false");
});

test("usa o preço final obrigatório e mantém tarifas pública e de membro", () => {
  const result = parseIbisPelotasDailyAvailability(
    params.checkIn,
    1,
    buildIbisPelotasSearchUrl(params),
    availabilityPayload(),
  );

  assert.equal(result.status, "success");
  assert.equal(result.bestPrice, 266.33);
  assert.deepEqual(
    result.offers.map((item) => item.price),
    [266.33, 280.35, 298],
  );
  assert.equal(result.offers[0].roomName, "Quarto Standard com 1 cama de casal");
  assert.equal(result.offers[0].breakfastIncluded, true);
  assert.equal(result.offers[0].refundable, true);
  assert.equal(result.offers[0].offerUrl, null);
});

test("preserva tarifas diferentes do mesmo quarto", () => {
  const payload = availabilityPayload();
  payload.data.publicOffers.offersSelection.offers.push(
    offer({
      amount: 240,
      tax: "Impostos não incluídos : R$ 12,00.",
      category: "STANDARD",
      rateId: "NRF",
      cancellationCode: "NON_REFUNDABLE",
    }),
  );
  const result = parseIbisPelotasDailyAvailability(
    params.checkIn,
    1,
    buildIbisPelotasSearchUrl(params),
    payload,
  );
  const doubleRoom = result.offers.filter((item) =>
    item.id.includes("-DBC-"),
  );

  assert.equal(doubleRoom.length, 3);
  assert.ok(doubleRoom.some((item) => item.refundable === false));
  assert.equal(result.bestPrice, 252);
});

test("consulta GraphQL usa BRL, uma diária por resultado e nenhum cookie ou auth", async () => {
  const requests: Array<{ input: string; init: RequestInit }> = [];
  const provider = new IbisPelotasOfficialProvider({
    fetcher: async (input, init) => {
      requests.push({ input: String(input), init: init ?? {} });
      if ((init?.method ?? "GET") === "GET") return new Response(accorHtml);
      return new Response(JSON.stringify(availabilityPayload()));
    },
  });
  const [day] = await provider.search(params, hotel);

  assert.equal(day.result.status, "success");
  assert.equal(requests.length, 2);
  const headers = new Headers(requests[1].init.headers);
  assert.equal(headers.get("apiKey"), "public-test-key");
  assert.equal(headers.get("app-id"), "all.accor");
  assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("authorization"), false);
  const body = JSON.parse(String(requests[1].init.body));
  assert.equal(body.variables.dateIn, "2026-09-01");
  assert.equal(body.variables.dateOut, "2026-09-02");
  assert.equal(body.variables.nbAdults, 1);
  assert.equal(body.variables.totalRoomInBasket, 1);
  assert.deepEqual(body.variables.childrenAges, []);
  assert.equal(body.variables.currency, "BRL");
});

test("período de várias noites consulta cada diária sem dividir total", async () => {
  const multiNight = {
    ...params,
    checkOut: "2026-09-03",
    nights: 2,
  } satisfies ValidatedPricingSearch;
  const postedDates: string[] = [];
  const provider = new IbisPelotasOfficialProvider({
    fetcher: async (_input, init) => {
      if ((init?.method ?? "GET") === "GET") return new Response(accorHtml);
      const body = JSON.parse(String(init?.body));
      postedDates.push(body.variables.dateIn);
      const firstNight = body.variables.dateIn === "2026-09-01";
      return new Response(
        JSON.stringify(
          availabilityPayload(
            firstNight ? 253.65 : 300,
            firstNight ? 267 : 320,
          ),
        ),
      );
    },
  });
  const days = await provider.search(multiNight, hotel);

  assert.deepEqual(postedDates.sort(), ["2026-09-01", "2026-09-02"]);
  assert.deepEqual(days.map((day) => day.result.bestPrice), [266.33, 298]);
  assert.equal(new URL(days[1].result.searchUrl!).searchParams.get("dateIn"), "2026-09-02");
  assert.equal(new URL(days[1].result.searchUrl!).searchParams.get("nights"), "1");
});

test("resposta válida sem ofertas é unavailable", () => {
  const payload = availabilityPayload();
  payload.data.memberOffers.offersSelection.offers = [];
  payload.data.publicOffers.offersSelection.offers = [];
  payload.data.memberOffers.availability.status = "NOT_AVAILABLE";
  payload.data.publicOffers.availability.status = "NOT_AVAILABLE";
  const result = parseIbisPelotasDailyAvailability(
    params.checkIn,
    1,
    buildIbisPelotasSearchUrl(params),
    payload,
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.bestPrice, null);
  assert.deepEqual(result.offers, []);
});

test("status desconhecido ou preço base zero é erro técnico, não indisponibilidade", () => {
  const unknown = availabilityPayload();
  unknown.data.memberOffers.availability.status = "UPSTREAM_ERROR";
  unknown.data.memberOffers.offersSelection.offers = [];
  assert.throws(() => parseIbisPelotasDailyAvailability(params.checkIn, 1, "https://example.com", unknown));
  assert.throws(() => parseIbisPelotasDailyAvailability(params.checkIn, 1, "https://example.com", availabilityPayload(0)));
});

test("uma diária com falha preserva sucessos, limita concorrência a três e encerra os sinais", async () => {
  let active = 0;
  let peak = 0;
  const signals: AbortSignal[] = [];
  const provider = new IbisPelotasOfficialProvider({
    fetcher: async (_input, init) => {
      if (init?.signal) signals.push(init.signal);
      if ((init?.method ?? "GET") === "GET") return new Response(accorHtml);
      active += 1;
      peak = Math.max(peak, active);
      try {
        const body = JSON.parse(String(init?.body));
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (body.variables.dateIn === "2026-09-02") {
          throw new Error("Falha temporária simulada");
        }
        return new Response(JSON.stringify(availabilityPayload()));
      } finally {
        active -= 1;
      }
    },
  });
  const days = await provider.search({ ...params, nights: 5, checkOut: "2026-09-06" }, hotel);
  assert.deepEqual(days.map((day) => day.result.status), ["success", "error", "success", "success", "success"]);
  assert.equal(days[0].result.bestPrice, 266.33);
  assert.equal(days[2].result.bestPrice, 266.33);
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("configuração ou JSON inesperado vira erro técnico", async () => {
  const provider = new IbisPelotasOfficialProvider({
    fetcher: async () => new Response("<html>sem configuração</html>"),
  });
  const [day] = await provider.search(params, hotel);
  assert.equal(day.result.status, "error");
});

test("desafio humano explícito preserva o link sem tentar contorná-lo", async () => {
  const provider = new IbisPelotasOfficialProvider({
    fetcher: async () =>
      new Response("Incapsula incident: captcha", { status: 403 }),
  });
  const [day] = await provider.search(params, hotel);
  assert.equal(day.result.status, "manual_verification_required");
  assert.equal(day.result.manualVerification?.reason, "captcha_required");
  assert.ok(day.result.searchUrl?.includes("all.accor.com"));
});

test("hybrid substitui somente o site do ibis e mantém seu Trivago mock", async () => {
  const mock = new MockPricingProvider();
  const mockDays = await mock.search(params, [hotel]);
  const realSource: SourceResult = {
    source: "official_site",
    status: "success",
    bestPrice: 266.33,
    bestProvider: "Site oficial",
    searchUrl: buildIbisPelotasSearchUrl(params),
    offers: [],
  };
  const realProvider: OfficialSitePricingProvider = {
    hotelSlug: hotel.slug,
    async search() {
      return [{ date: params.checkIn, result: realSource }];
    },
  };
  const hybrid = new HybridPricingProvider(
    mock,
    new Map([[hotel.slug, realProvider]]),
  );
  const days = await hybrid.search(params, [hotel]);

  assert.equal(days[0].hotels[0].officialSite, realSource);
  assert.deepEqual(days[0].hotels[0].trivago, mockDays[0].hotels[0].trivago);
});
