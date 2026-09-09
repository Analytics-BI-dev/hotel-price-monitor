import assert from "node:assert/strict";
import test from "node:test";

import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import {
  buildCuriPalaceSearchUrl,
  CuriPalaceOfficialProvider,
  parseCuriPalaceAvailability,
} from "../src/providers/pricing/official-sites/curi-palace.ts";
import type { OfficialSitePricingProvider } from "../src/providers/pricing/types.ts";
import type {
  PricingHotel,
  SourceResult,
  ValidatedPricingSearch,
} from "../src/types/pricing.ts";

const hotel: PricingHotel = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Curi Palace Hotel",
  slug: "curi-palace-hotel",
  is_reference_hotel: false,
  official_site_enabled: true,
  official_site_url: "https://www.curipalacehotel.com.br/",
  trivago_enabled: true,
  trivago_property_id: "palace-mock",
};

const params: ValidatedPricingSearch = {
  checkIn: "2026-09-15",
  checkOut: "2026-09-16",
  adults: 1,
  rooms: 1,
  children: 0,
  nights: 1,
};

const rateTypes = [
  {
    Id: "flexible",
    MealPlanView: "Café da Manhã",
    ExtraProducts: [{ Name: "WIFI" }, { Name: "Café da Manhã" }],
    PaymentPolicy: { IsNonRefundable: false },
  },
  {
    Id: "non-refundable",
    MealPlanView: "Café da Manhã",
    PaymentPolicy: { IsNonRefundable: true },
  },
];

const hbookHtml = `
  <input id="availabilityToken" type="hidden" value="ephemeral-palace-token">
  <script>var rateTypes = ${JSON.stringify(rateTypes)};</script>
`;

function availabilityPayload(date: string) {
  return {
    HasErrors: false,
    Rooms: [
      {
        Availability: 5,
        RoomTypeId: "standard",
        RoomTypeName: "APARTAMENTO STANDARD",
        Rates: [
          {
            RateTypeId: "non-refundable",
            RateTypeName: "Não reembolsável",
            PerDayRates: [{ Date: `${date}T00:00:00Z`, Rate: "R$ 250,00" }],
          },
          {
            RateTypeId: "flexible",
            RateTypeName: "Flexível",
            PerDayRates: [{ Date: `${date}T00:00:00Z`, Rate: "R$ 263,00" }],
          },
        ],
      },
      {
        Availability: 2,
        RoomTypeId: "superior",
        RoomTypeName: "APARTAMENTO SUPERIOR",
        Rates: [
          {
            RateTypeId: "flexible",
            PerDayRates: [{ Date: `${date}T00:00:00Z`, Rate: "R$ 1.298,50" }],
          },
        ],
      },
    ],
  };
}

test("gera a pesquisa equivalente para 1 quarto, zero crianças e 1 ou 2 adultos", () => {
  const oneAdult = new URL(buildCuriPalaceSearchUrl(params));
  const twoAdults = new URL(
    buildCuriPalaceSearchUrl({ ...params, adults: 2 }),
  );

  assert.equal(oneAdult.hostname, "hbook.hsystem.com.br");
  assert.equal(oneAdult.pathname, "/booking");
  assert.equal(
    oneAdult.searchParams.get("companyId"),
    "61607dad584d1d88bb3eb28f",
  );
  assert.equal(oneAdult.searchParams.get("checkin"), "15/09/2026");
  assert.equal(oneAdult.searchParams.get("checkout"), "16/09/2026");
  assert.equal(oneAdult.searchParams.get("adults"), "1");
  assert.equal(twoAdults.searchParams.get("adults"), "2");
  assert.equal(oneAdult.searchParams.get("children"), "0");
});

test("preserva várias tarifas do mesmo quarto e normaliza preço brasileiro", () => {
  const [day] = parseCuriPalaceAvailability(
    params,
    buildCuriPalaceSearchUrl(params),
    availabilityPayload(params.checkIn),
    new Map([
      ["non-refundable", { breakfastIncluded: true, refundable: false }],
      ["flexible", { breakfastIncluded: true, refundable: true }],
    ]),
  );

  assert.equal(day.result.status, "success");
  assert.equal(day.result.bestPrice, 250);
  assert.deepEqual(
    day.result.offers.map((offer) => offer.price),
    [250, 263, 1298.5],
  );
  assert.equal(day.result.offers[0].roomName, "APARTAMENTO STANDARD");
  assert.equal(day.result.offers[0].refundable, false);
  assert.equal(day.result.offers[1].refundable, true);
  assert.ok(day.result.offers.every((offer) => offer.id.startsWith("curi-palace-")));
});

test("consulta server-side envia somente os parâmetros públicos necessários", async () => {
  const requests: Array<{ input: string; init: RequestInit }> = [];
  const provider = new CuriPalaceOfficialProvider({
    fetcher: async (input, init) => {
      requests.push({ input: String(input), init: init ?? {} });
      if ((init?.method ?? "GET") === "GET") return new Response(hbookHtml);
      return new Response(JSON.stringify(availabilityPayload(params.checkIn)));
    },
  });
  const [day] = await provider.search(params, hotel);

  assert.equal(day.result.status, "success");
  assert.equal(requests.length, 2);
  for (const request of requests) {
    const headers = new Headers(request.init.headers);
    assert.equal(headers.has("cookie"), false);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("x-recaptcha-token"), false);
    assert.equal(request.init.cache, "no-store");
  }

  const posted = JSON.parse(String(requests[1].init.body));
  assert.equal(posted.CompanyId, "61607dad584d1d88bb3eb28f");
  assert.equal(posted.AmountAdults, 1);
  assert.equal(posted.AmountChildren, 0);
  assert.deepEqual(posted.ChildrenAges, []);
  assert.equal(posted.AvailabilityToken, "ephemeral-palace-token");
  assert.equal(String(requests[1].init.body).toLowerCase().includes("captcha"), false);
});

test("2 adultos e outra data chegam intactos ao endpoint", async () => {
  const otherParams = {
    ...params,
    checkIn: "2026-09-22",
    checkOut: "2026-09-23",
    adults: 2,
  } satisfies ValidatedPricingSearch;
  let posted: Record<string, unknown> = {};
  const provider = new CuriPalaceOfficialProvider({
    fetcher: async (_input, init) => {
      if ((init?.method ?? "GET") === "GET") return new Response(hbookHtml);
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(availabilityPayload(otherParams.checkIn)));
    },
  });
  const [day] = await provider.search(otherParams, hotel);

  assert.equal(day.result.status, "success");
  assert.equal(posted.AmountAdults, 2);
  assert.equal(posted.ArrivalDateString, "22/09/2026");
  assert.equal(posted.DepartureDateString, "23/09/2026");
});

test("preços de várias diárias são mantidos por data", () => {
  const multiNight = {
    ...params,
    checkOut: "2026-09-17",
    nights: 2,
  } satisfies ValidatedPricingSearch;
  const payload = availabilityPayload(params.checkIn);
  payload.Rooms = [
    {
      ...payload.Rooms[0],
      Rates: [{
        ...payload.Rooms[0].Rates[0],
        PerDayRates: [
          { Date: "2026-09-15T00:00:00Z", Rate: "R$ 250,00" },
          { Date: "2026-09-16T00:00:00Z", Rate: "R$ 270,00" },
        ],
      }],
    },
  ];
  const days = parseCuriPalaceAvailability(
    multiNight,
    buildCuriPalaceSearchUrl(multiNight),
    payload,
  );

  assert.deepEqual(days.map((day) => day.result.bestPrice), [250, 270]);
});

test("resposta válida sem quartos é unavailable", () => {
  const [day] = parseCuriPalaceAvailability(
    params,
    buildCuriPalaceSearchUrl(params),
    { HasErrors: false, Rooms: [] },
  );
  assert.equal(day.result.status, "unavailable");
  assert.equal(day.result.bestPrice, null);
  assert.deepEqual(day.result.offers, []);
});

test("disponibilidade inválida não autoriza preço e café explicitamente ausente é reconhecido", async () => {
  const payload = availabilityPayload(params.checkIn);
  payload.Rooms[0].Availability = Number.NaN;
  assert.throws(() => parseCuriPalaceAvailability(params, buildCuriPalaceSearchUrl(params), payload));
  const provider = new CuriPalaceOfficialProvider({
    fetcher: async (_input, init) => new Response(
      (init?.method ?? "GET") === "GET"
        ? hbookHtml.replaceAll("Café da Manhã", "Sem café da manhã")
        : JSON.stringify(availabilityPayload(params.checkIn)),
    ),
  });
  const [day] = await provider.search(params, hotel);
  assert.equal(day.result.bestPrice, 250);
  assert.equal(day.result.offers[0].breakfastIncluded, false);
});

test("HTML inesperado é erro técnico", async () => {
  const provider = new CuriPalaceOfficialProvider({
    fetcher: async () => new Response("<html>sem token</html>"),
  });
  const [day] = await provider.search(params, hotel);
  assert.equal(day.result.status, "error");
});

test("CAPTCHA explícito pede verificação manual sem tentar resolvê-lo", async () => {
  const provider = new CuriPalaceOfficialProvider({
    fetcher: async () => new Response("captcha challenge", { status: 403 }),
  });
  const [day] = await provider.search(params, hotel);
  assert.equal(day.result.status, "manual_verification_required");
  assert.equal(day.result.manualVerification?.reason, "captcha_required");
  assert.equal(day.result.searchUrl, buildCuriPalaceSearchUrl(params));
});

test("hybrid troca somente o site do Palace e mantém seu Trivago mock", async () => {
  const mock = new MockPricingProvider();
  const mockDays = await mock.search(params, [hotel]);
  const realSource: SourceResult = {
    source: "official_site",
    status: "success",
    bestPrice: 250,
    bestProvider: "Site oficial",
    searchUrl: buildCuriPalaceSearchUrl(params),
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
  const hybridDays = await hybrid.search(params, [hotel]);

  assert.equal(hybridDays[0].hotels[0].officialSite, realSource);
  assert.deepEqual(hybridDays[0].hotels[0].trivago, mockDays[0].hotels[0].trivago);
});
