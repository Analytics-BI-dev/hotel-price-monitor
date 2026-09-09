import assert from "node:assert/strict";
import test from "node:test";

import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import {
  buildCuriExecutiveSearchUrl,
  CuriExecutiveOfficialProvider,
  parseCuriBrazilianPrice,
  parseCuriExecutiveAvailability,
} from "../src/providers/pricing/official-sites/curi-executive.ts";
import type { OfficialSitePricingProvider } from "../src/providers/pricing/types.ts";
import type {
  PricingHotel,
  SourceResult,
  ValidatedPricingSearch,
} from "../src/types/pricing.ts";

const hotel: PricingHotel = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Hotel Curi Executive",
  slug: "hotel-curi-executive",
  is_reference_hotel: true,
  official_site_enabled: true,
  official_site_url: "https://www.hotelcuri.com.br/",
  trivago_enabled: true,
  trivago_property_id: "curi-mock",
};

const params: ValidatedPricingSearch = {
  checkIn: "2026-09-01",
  checkOut: "2026-09-02",
  adults: 1,
  rooms: 1,
  children: 0,
  nights: 1,
};

const rateTypes = [
  {
    Id: "1438558414",
    Name: "Melhor Tarifa Disponível",
    MealPlan: 1,
    MealPlanView: "Café da Manhã",
    ExtraProducts: [{ Name: "Café da Manhã" }, { Name: "WIFI" }],
    PaymentPolicy: {
      IsNonRefundable: false,
      CancellationPolicy: { Description: "Cancelamento permitido." },
    },
  },
];

const hbookHtml = `
  <html>
    <body>
      <input id="availabilityToken" type="hidden" value="ephemeral-test-token">
      <script>var rateTypes = ${JSON.stringify(rateTypes)};</script>
    </body>
  </html>
`;

function availabilityPayload(
  date: string,
  prices: [number, number, number] = [215, 225, 269],
) {
  return {
    HasErrors: false,
    Rooms: [
      {
        Availability: 4,
        RoomTypeId: "standard",
        RoomTypeName: "Quarto Standard",
        Rates: [
          {
            RateTypeId: "1438558414",
            RateTypeName: "Melhor Tarifa Disponível",
            DailyPrice: prices[0],
            TotalValue: prices[0],
            PerDayRates: [{ Date: `${date}T00:00:00Z`, Rate: prices[0] }],
          },
        ],
      },
      {
        Availability: 2,
        RoomTypeId: "superior",
        RoomTypeName: "Quarto Superior",
        Rates: [
          {
            RateTypeId: "1438558414",
            RateTypeName: "Melhor Tarifa Disponível",
            DailyPrice: prices[1],
            TotalValue: prices[1],
            PerDayRates: [{ Date: `${date}T00:00:00Z`, Rate: prices[1] }],
          },
        ],
      },
      {
        Availability: 1,
        RoomTypeId: "executive",
        RoomTypeName: "Quarto Executive",
        Rates: [
          {
            RateTypeId: "1438558414",
            RateTypeName: "Melhor Tarifa Disponível",
            DailyPrice: prices[2],
            TotalValue: prices[2],
            PerDayRates: [{ Date: `${date}T00:00:00Z`, Rate: prices[2] }],
          },
        ],
      },
    ],
  };
}

test("normaliza preços brasileiros sem usar parseFloat diretamente", () => {
  assert.equal(parseCuriBrazilianPrice("R$ 298,00"), 298);
  assert.equal(parseCuriBrazilianPrice("R$ 1.298,50"), 1298.5);
  assert.equal(parseCuriBrazilianPrice("215.00"), 215);
  assert.equal(parseCuriBrazilianPrice("—"), null);
});

test("gera a mesma pesquisa do HBook para 1 ou 2 adultos", () => {
  const oneAdult = new URL(buildCuriExecutiveSearchUrl(params));
  const twoAdults = new URL(
    buildCuriExecutiveSearchUrl({ ...params, adults: 2 }),
  );

  assert.equal(oneAdult.hostname, "hbook.hsystem.com.br");
  assert.equal(oneAdult.pathname, "/booking");
  assert.equal(
    oneAdult.searchParams.get("companyId"),
    "617028bb0228061225bd735e",
  );
  assert.equal(oneAdult.searchParams.get("checkin"), "01/09/2026");
  assert.equal(oneAdult.searchParams.get("checkout"), "02/09/2026");
  assert.equal(oneAdult.searchParams.get("adults"), "1");
  assert.equal(twoAdults.searchParams.get("adults"), "2");
  assert.equal(oneAdult.searchParams.get("children"), "0");
});

test("consulta server-side usa token efêmero, sem cookie, auth ou CAPTCHA", async () => {
  const requests: Array<{ input: string; init: RequestInit }> = [];
  const provider = new CuriExecutiveOfficialProvider({
    fetcher: async (input, init) => {
      requests.push({ input: String(input), init: init ?? {} });
      if ((init?.method ?? "GET") === "GET") {
        return new Response(hbookHtml, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response(
        JSON.stringify(availabilityPayload("2026-09-01")),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const [day] = await provider.search(params, hotel);

  assert.equal(day.result.status, "success");
  assert.equal(day.result.bestPrice, 215);
  assert.equal(day.result.offers.length, 3);
  assert.equal(day.result.offers[0].roomName, "Quarto Standard");
  assert.equal(day.result.offers[0].breakfastIncluded, true);
  assert.equal(day.result.offers[0].refundable, true);
  assert.equal(requests.length, 2);

  for (const request of requests) {
    const headers = new Headers(request.init.headers);
    assert.equal(headers.has("cookie"), false);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("x-recaptcha-token"), false);
    assert.equal(request.init.cache, "no-store");
  }

  const posted = JSON.parse(String(requests[1].init.body));
  assert.equal(posted.AmountAdults, 1);
  assert.equal(posted.AmountChildren, 0);
  assert.deepEqual(posted.ChildrenAges, []);
  assert.equal(posted.AvailabilityToken, "ephemeral-test-token");
  assert.equal(String(requests[1].init.body).toLowerCase().includes("captcha"), false);
});

test("2 adultos e outra data usam os parâmetros e preços correspondentes", async () => {
  const otherParams: ValidatedPricingSearch = {
    ...params,
    checkIn: "2026-09-08",
    checkOut: "2026-09-09",
    adults: 2,
  };
  let postedBody: Record<string, unknown> | null = null;
  const provider = new CuriExecutiveOfficialProvider({
    fetcher: async (_input, init) => {
      if ((init?.method ?? "GET") === "GET") return new Response(hbookHtml);
      postedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify(availabilityPayload("2026-09-08", [229, 239, 369])),
      );
    },
  });
  const [day] = await provider.search(otherParams, hotel);

  assert.equal(day.result.bestPrice, 229);
  assert.equal(day.result.offers.length, 3);
  assert.equal(postedBody?.AmountAdults, 2);
  assert.equal(postedBody?.ArrivalDateString, "08/09/2026");
});

test("período de várias diárias usa o preço real de cada dia", () => {
  const multiNightParams: ValidatedPricingSearch = {
    ...params,
    checkOut: "2026-09-03",
    nights: 2,
  };
  const payload = availabilityPayload("2026-09-01", [215, 225, 269]);
  payload.Rooms = [
    {
      ...payload.Rooms[0],
      Rates: [
        {
          ...payload.Rooms[0].Rates[0],
          TotalValue: 435,
          PerDayRates: [
            { Date: "2026-09-01T00:00:00Z", Rate: 215 },
            { Date: "2026-09-02T00:00:00Z", Rate: 220 },
          ],
        },
      ],
    },
  ];
  const days = parseCuriExecutiveAvailability(
    multiNightParams,
    buildCuriExecutiveSearchUrl(multiNightParams),
    payload,
  );

  assert.deepEqual(
    days.map((day) => day.result.bestPrice),
    [215, 220],
  );
});

test("resposta válida sem quartos é indisponibilidade", () => {
  const [day] = parseCuriExecutiveAvailability(
    params,
    buildCuriExecutiveSearchUrl(params),
    { HasErrors: false, Rooms: [] },
  );

  assert.equal(day.result.status, "unavailable");
  assert.equal(day.result.bestPrice, null);
  assert.deepEqual(day.result.offers, []);
});

test("disponibilidade ausente não autoriza preço e café explicitamente ausente é reconhecido", async () => {
  const payload = availabilityPayload(params.checkIn);
  Reflect.deleteProperty(payload.Rooms[0], "Availability");
  assert.throws(() => parseCuriExecutiveAvailability(params, buildCuriExecutiveSearchUrl(params), payload));
  const provider = new CuriExecutiveOfficialProvider({
    fetcher: async (_input, init) => new Response(
      (init?.method ?? "GET") === "GET"
        ? hbookHtml.replaceAll("Café da Manhã", "Sem café da manhã")
        : JSON.stringify(availabilityPayload(params.checkIn)),
    ),
  });
  const [day] = await provider.search(params, hotel);
  assert.equal(day.result.bestPrice, 215);
  assert.equal(day.result.offers[0].breakfastIncluded, false);
});

test("HTML ou JSON inesperado vira erro técnico", async () => {
  const provider = new CuriExecutiveOfficialProvider({
    fetcher: async () => new Response("<html>sem token</html>"),
  });
  const [day] = await provider.search(params, hotel);

  assert.equal(day.result.status, "error");
  assert.equal(day.result.bestPrice, null);
  assert.deepEqual(day.result.offers, []);
});

test("desafio CAPTCHA explícito usa verificação manual sem tentar resolvê-lo", async () => {
  const provider = new CuriExecutiveOfficialProvider({
    fetcher: async () => new Response("captcha challenge", { status: 403 }),
  });
  const [day] = await provider.search(params, hotel);

  assert.equal(day.result.status, "manual_verification_required");
  assert.equal(day.result.searchUrl, buildCuriExecutiveSearchUrl(params));
  assert.equal(day.result.manualVerification?.reason, "captcha_required");
});

test("composição troca somente o site oficial do Curi e mantém Trivago mock", async () => {
  const mock = new MockPricingProvider();
  const mockDays = await mock.search(params, [hotel]);
  const realSource: SourceResult = {
    source: "official_site",
    status: "success",
    bestPrice: 215,
    bestProvider: "Site oficial",
    searchUrl: buildCuriExecutiveSearchUrl(params),
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
  assert.deepEqual(
    hybridDays[0].hotels[0].trivago,
    mockDays[0].hotels[0].trivago,
  );
});
