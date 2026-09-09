import assert from "node:assert/strict";
import test from "node:test";

import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import {
  buildTrivagoSearchUrl,
  mergeTrivagoOfferDetails,
  parseTrivagoGraphqlOffers,
  parseTrivagoBrazilianPrice,
  TrivagoPricingProvider,
} from "../src/providers/pricing/trivago/trivago-pricing-provider.ts";
import type {
  TrivagoCollectionOutcome,
  TrivagoCollectionRequest,
} from "../src/providers/pricing/trivago/trivago-pricing-provider.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

const hotel: PricingHotel = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Hotel Curi Executive",
  slug: "hotel-curi-executive",
  is_reference_hotel: true,
  official_site_enabled: true,
  official_site_url: "https://www.hotelcuri.com.br/",
  trivago_enabled: true,
  trivago_property_id: "2436946",
};

const competitor: PricingHotel = {
  ...hotel,
  id: "00000000-0000-4000-8000-000000000002",
  name: "Hotel Alles Blau",
  slug: "hotel-alles-blau",
  is_reference_hotel: false,
  trivago_property_id: "7770070",
};

const params: ValidatedPricingSearch = {
  checkIn: "2026-09-10",
  checkOut: "2026-09-11",
  adults: 1,
  rooms: 1,
  children: 0,
  nights: 1,
};

function createProvider(
  outcomes: TrivagoCollectionOutcome[],
  onRequests?: (requests: TrivagoCollectionRequest[]) => void,
) {
  return new TrivagoPricingProvider({
    propertyId: "2436946",
    hotelName: "Hotel Curi Executive",
    hotelSlug: "hotel-curi-executive",
    searchPathSlug: "hotel-curi-executive-pelotas",
    retryDelaysMs: [0, 0],
    collector: async (requests) => {
      onRequests?.(requests);
      return outcomes;
    },
  });
}

test("normaliza valores brasileiros do Trivago sem parseFloat direto", () => {
  assert.equal(parseTrivagoBrazilianPrice("R$ 233"), 233);
  assert.equal(parseTrivagoBrazilianPrice("R$\u00a01.233"), 1233);
  assert.equal(parseTrivagoBrazilianPrice("R$ 1.233,50"), 1233.5);
  assert.equal(parseTrivagoBrazilianPrice("R$ 233,90"), 233.9);
  assert.equal(
    parseTrivagoBrazilianPrice("Preço anterior R$ 248 Preço real R$ 224"),
    224,
  );
  assert.equal(parseTrivagoBrazilianPrice("—"), null);
});

test("monta URL pelo property id com diária, um quarto e 1 ou 2 adultos", () => {
  const config = {
    propertyId: "2436946",
    hotelSlug: "hotel-curi-executive",
    searchPathSlug: "hotel-curi-executive-pelotas",
  };
  const oneAdult = new URL(buildTrivagoSearchUrl(params, config));
  const twoAdults = new URL(
    buildTrivagoSearchUrl({ ...params, adults: 2 }, config),
  );

  assert.equal(oneAdult.hostname, "www.trivago.com.br");
  assert.equal(oneAdult.pathname, "/pt-BR/lm/hotel-curi-executive-pelotas");
  assert.equal(
    oneAdult.searchParams.get("search"),
    "100-2436946;dr-20260910-20260911;drs-40;rc-1-1",
  );
  assert.equal(
    twoAdults.searchParams.get("search"),
    "100-2436946;dr-20260910-20260911;drs-40;rc-1-2",
  );
});

test("extrai todos os deals estruturados da propriedade exata sem duplicar cheapest", () => {
  const deal = (id: string, advertiserId: number, price: number) => ({
    id,
    advertiserDetails: { nsid: { ns: 400, id: advertiserId } },
    accommodationDetails: { nsid: { ns: 100, id: 2436946 } },
    allInPricePerNight: { amount: price },
  });
  const expedia = deal("expedia", 406, 224);
  const parsed = parseTrivagoGraphqlOffers(
    {
      data: {
        accommodationSearchResponse: {
          accommodations: [
            {
              nsid: { ns: 100, id: 2436946 },
              deals: {
                best: deal("booking", 626, 229),
                alternatives: [expedia, deal("agoda", 395, 229)],
                cheapest: expedia,
              },
            },
          ],
        },
      },
    },
    "2436946",
  );

  assert.equal(parsed.propertyFound, true);
  assert.equal(parsed.complete, true);
  assert.deepEqual(
    parsed.offers.map((offer) => [offer.providerName, offer.priceText]),
    [
      ["Booking.com", "R$ 229"],
      ["Expedia", "R$ 224"],
      ["Agoda", "R$ 229"],
    ],
  );
});

test("reconhece os anunciantes observados nos demais hotéis", () => {
  const advertiserNames = new Map([
    [634, "Trip.com"],
    [1852, "Decolar"],
    [3340, "Hoteis.com"],
    [3620, "Ourtrip"],
    [3708, "Quero Passagem"],
  ]);
  const parsed = parseTrivagoGraphqlOffers(
    {
      data: {
        accommodationSearchResponse: {
          accommodations: [
            {
              nsid: { ns: 100, id: 2436946 },
              deals: {
                best: {
                  id: "best",
                  advertiserDetails: { nsid: { ns: 400, id: 634 } },
                  accommodationDetails: { nsid: { ns: 100, id: 2436946 } },
                  allInPricePerNight: { amount: 219 },
                },
                alternatives: Array.from(advertiserNames.keys())
                  .slice(1)
                  .map((advertiserId) => ({
                    id: String(advertiserId),
                    advertiserDetails: { nsid: { ns: 400, id: advertiserId } },
                    accommodationDetails: {
                      nsid: { ns: 100, id: 2436946 },
                    },
                    allInPricePerNight: { amount: advertiserId },
                  })),
                cheapest: null,
              },
            },
          ],
        },
      },
    },
    "2436946",
  );

  assert.equal(parsed.complete, true);
  assert.deepEqual(
    parsed.offers.map((offer) => offer.providerName),
    Array.from(advertiserNames.values()),
  );
  assert.deepEqual(parsed.unmappedAdvertisers, []);
});

test("extrai somente detalhes estruturados confiáveis da oferta GraphQL", () => {
  const parsed = parseTrivagoGraphqlOffers(
    {
      data: {
        accommodationSearchResponse: {
          accommodations: [
            {
              nsid: { ns: 100, id: 2436946 },
              deals: {
                best: {
                  id: "expedia",
                  advertiserDetails: { nsid: { ns: 400, id: 406 } },
                  accommodationDetails: { nsid: { ns: 100, id: 2436946 } },
                  allInPricePerNight: { amount: 224 },
                  roomCategory: { name: "Quarto Standard" },
                  rateName: "Tarifa flexível",
                  priceDetails: {
                    freeCancellationDeadline: "2026-09-08T21:00:00Z",
                    breakfastIncluded: true,
                  },
                },
                alternatives: [],
                cheapest: null,
              },
            },
          ],
        },
      },
    },
    "2436946",
  );

  assert.equal(parsed.complete, true);
  assert.deepEqual(parsed.offers[0], {
    providerName: "Expedia",
    priceText: "R$ 224",
    roomName: "Quarto Standard",
    rateName: "Tarifa flexível",
    detailsText: "Cancelamento gratuito até 08/09/2026",
    breakfastIncluded: true,
    refundable: true,
    attributes: [],
  });
});

test("associa detalhe DOM somente à oferta com provider e preço únicos", () => {
  const structured = [
    {
      providerName: "Agoda",
      priceText: "R$ 281",
      roomName: null,
      attributes: [],
    },
    {
      providerName: "Booking.com",
      priceText: "R$ 325",
      roomName: null,
      attributes: [],
    },
  ];
  const merged = mergeTrivagoOfferDetails(structured, [
    {
      providerName: "Booking.com",
      priceText: "R$ 325",
      roomName: "Quarto Standard Superior",
      attributes: ["Café da manhã incluído", "Não reembolsável"],
    },
  ]);

  assert.equal(merged.enriched, true);
  assert.equal(merged.offers[0].roomName, null);
  assert.deepEqual(merged.offers[0].attributes, []);
  assert.equal(merged.offers[1].roomName, "Quarto Standard Superior");
  assert.deepEqual(merged.offers[1].attributes, [
    "Café da manhã incluído",
    "Não reembolsável",
  ]);

  const ambiguous = mergeTrivagoOfferDetails(
    [structured[1], structured[1]],
    [
      {
        providerName: "Booking.com",
        priceText: "R$ 325",
        roomName: "Não deve ser associado",
        attributes: [],
      },
    ],
  );
  assert.equal(ambiguous.enriched, false);
  assert.equal(ambiguous.offers[0].roomName, null);
});

test("rejeita ofertas GraphQL que não pertencem inequivocamente à propriedade", () => {
  const parsed = parseTrivagoGraphqlOffers(
    {
      data: {
        accommodationSearchResponse: {
          accommodations: [
            {
              nsid: { ns: 100, id: 9999999 },
              deals: {
                best: null,
                alternatives: [],
                cheapest: null,
              },
            },
          ],
        },
      },
    },
    "2436946",
  );

  assert.equal(parsed.propertyFound, false);
  assert.equal(parsed.complete, false);
  assert.deepEqual(parsed.offers, []);
});

test("escolhe a menor de todas as ofertas, mesmo quando não é a destacada", async () => {
  const provider = createProvider([
    {
      kind: "success",
      offers: [
        {
          providerName: "Booking.com",
          priceText: "R$ 259",
          roomName: "Quarto Superior",
          attributes: ["Café da manhã incluído"],
        },
        {
          providerName: "Expedia",
          priceText: "R$ 224",
          roomName: "Quarto Standard",
          attributes: ["Cancelamento gratuito"],
        },
        {
          providerName: "Agoda",
          priceText: "R$ 259",
          roomName: null,
          attributes: [],
        },
      ],
    },
  ]);
  const [day] = await provider.search(params, hotel);

  assert.equal(day.result.status, "success");
  assert.equal(day.result.bestPrice, 224);
  assert.equal(day.result.bestProvider, "Expedia");
  assert.deepEqual(
    day.result.offers.map((offer) => [offer.providerName, offer.price]),
    [
      ["Expedia", 224],
      ["Agoda", 259],
      ["Booking.com", 259],
    ],
  );
  assert.equal(day.result.offers[0].refundable, true);
  assert.equal(day.result.offers[1].breakfastIncluded, null);
  assert.equal(day.result.offers[1].refundable, null);
  assert.equal(day.result.offers[1].roomName, null);
  assert.equal(day.result.offers[1].rateName, null);
  assert.equal(day.result.offers[1].detailsText, null);
  assert.match(day.result.searchUrl ?? "", /100-2436946/);
});

test("preserva 2 adultos e todas as variantes reais entregues pelo coletor", async () => {
  let captured: TrivagoCollectionRequest[] = [];
  const provider = createProvider(
    [
      {
        kind: "success",
        offers: [
          {
            providerName: "HRS.com",
            priceText: "R$ 289",
            roomName: "Quarto Standard",
            attributes: [
              "Cancelamento gratuito até 8 de set.",
              "Café da manhã incluído",
            ],
          },
          {
            providerName: "Booking.com",
            priceText: "R$ 329",
            roomName: "Quarto Superior - Não Reembolsável",
            attributes: ["Café da manhã incluído"],
          },
          {
            providerName: "Booking.com",
            priceText: "R$ 355",
            roomName: "Quarto Duplo - Não Reembolsável",
            attributes: ["Café da manhã incluído"],
          },
        ],
      },
    ],
    (requests) => {
      captured = requests;
    },
  );
  const [day] = await provider.search({ ...params, adults: 2 }, hotel);

  assert.equal(captured[0].adults, 2);
  assert.match(captured[0].searchUrl, /rc-1-2$/);
  assert.equal(day.result.offers.length, 3);
  assert.equal(day.result.bestProvider, "HRS.com");
  assert.equal(day.result.offers[1].refundable, false);
  assert.equal(day.result.offers[0].breakfastIncluded, true);
});

test("consulta cada diária exatamente até o dia seguinte", async () => {
  let captured: TrivagoCollectionRequest[] = [];
  const provider = createProvider(
    [
      { kind: "unavailable" },
      { kind: "unavailable" },
      { kind: "unavailable" },
    ],
    (requests) => {
      captured = requests;
    },
  );
  await provider.search(
    { ...params, checkOut: "2026-09-13", nights: 3 },
    hotel,
  );

  assert.deepEqual(
    captured.map(({ date, checkoutDate }) => [date, checkoutDate]),
    [
      ["2026-09-10", "2026-09-11"],
      ["2026-09-11", "2026-09-12"],
      ["2026-09-12", "2026-09-13"],
    ],
  );
  assert.match(captured[1].searchUrl, /dr-20260911-20260912/);
});

test("diferencia indisponibilidade, erro técnico e verificação manual", async () => {
  const cases: Array<{
    outcome: TrivagoCollectionOutcome;
    expected: "unavailable" | "error" | "manual_verification_required";
  }> = [
    { outcome: { kind: "unavailable" }, expected: "unavailable" },
    {
      outcome: { kind: "error", message: "stream timeout" },
      expected: "error",
    },
    {
      outcome: { kind: "manual_verification_required" },
      expected: "manual_verification_required",
    },
  ];

  for (const { outcome, expected } of cases) {
    const [day] = await createProvider([outcome]).search(params, hotel);
    assert.equal(day.result.status, expected);
    assert.equal(day.result.bestPrice, null);
    assert.deepEqual(day.result.offers, []);
  }
});

test("repete HTTP 408 no máximo três vezes e aceita o sucesso da última tentativa", async () => {
  let calls = 0;
  const provider = new TrivagoPricingProvider({
    propertyId: "2436946",
    hotelName: "Hotel Curi Executive",
    hotelSlug: "hotel-curi-executive",
    retryDelaysMs: [0, 0],
    collector: async () => {
      calls += 1;
      return calls < 3
        ? [{ kind: "error", message: "HTTP 408 stream timeout" }]
        : [
            {
              kind: "success",
              offers: [
                {
                  providerName: "Expedia",
                  priceText: "R$ 224",
                  roomName: null,
                  attributes: [],
                },
              ],
            },
          ];
    },
  });

  const [day] = await provider.search(params, hotel);

  assert.equal(calls, 3);
  assert.equal(day.result.status, "success");
  assert.equal(day.result.bestPrice, 224);
});

test("repete HTTP 429 no máximo três vezes sem tratá-lo como CAPTCHA", async () => {
  let calls = 0;
  const provider = new TrivagoPricingProvider({
    propertyId: "2436946",
    hotelName: "Hotel Curi Executive",
    hotelSlug: "hotel-curi-executive",
    retryDelaysMs: [0, 0],
    collector: async () => {
      calls += 1;
      return calls < 3
        ? [{ kind: "error", message: "HTTP 429 no Trivago." }]
        : [
            {
              kind: "success",
              offers: [
                {
                  providerName: "Booking.com",
                  priceText: "R$ 230",
                  roomName: null,
                  attributes: [],
                },
              ],
            },
          ];
    },
  });

  const [day] = await provider.search(params, hotel);

  assert.equal(calls, 3);
  assert.equal(day.result.status, "success");
  assert.equal(day.result.bestPrice, 230);
});

test("repete HTTP 5xx e timeouts de GraphQL ou navegação no máximo três vezes", async () => {
  for (const message of [
    "HTTP 503 na consulta estruturada do Trivago.",
    "GraphQL timeout no Trivago.",
    "Navigation timeout ao abrir o Trivago.",
  ]) {
    let calls = 0;
    const provider = new TrivagoPricingProvider({
      propertyId: "2436946",
      hotelName: "Hotel Curi Executive",
      hotelSlug: "hotel-curi-executive",
      retryDelaysMs: [0, 0],
      collector: async () => {
        calls += 1;
        return [{ kind: "error", message }];
      },
    });

    const [day] = await provider.search(params, hotel);
    assert.equal(calls, 3, message);
    assert.equal(day.result.status, "error", message);
  }
});

test("deduplica somente pesquisas idênticas que ainda estão em andamento", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = new TrivagoPricingProvider({
    propertyId: "2436946",
    hotelName: "Hotel Curi Executive",
    hotelSlug: "hotel-curi-executive",
    retryDelaysMs: [0, 0],
    collector: async () => {
      calls += 1;
      await gate;
      return [{ kind: "unavailable" }];
    },
  });

  const first = provider.search(params, hotel);
  const duplicate = provider.search(params, hotel);
  await Promise.resolve();
  assert.equal(calls, 1);

  release?.();
  await Promise.all([first, duplicate]);
  await provider.search(params, hotel);
  assert.equal(calls, 2);
});

test("preço visível inválido é erro técnico, não indisponibilidade", async () => {
  const provider = createProvider([
    {
      kind: "success",
      offers: [
        {
          providerName: "Agoda",
          priceText: "consultar",
          roomName: null,
          attributes: [],
        },
      ],
    },
  ]);
  const [day] = await provider.search(params, hotel);

  assert.equal(day.result.status, "error");
  assert.equal(day.result.bestPrice, null);
});

test("sucesso do coletor sem ofertas ou fornecedor é erro técnico", async () => {
  for (const offers of [[], [{ providerName: null, priceText: "R$ 224", roomName: null, attributes: [] }]]) {
    const [day] = await createProvider([{ kind: "success", offers }]).search(params, hotel);
    assert.equal(day.result.status, "error");
    assert.equal(day.result.bestPrice, null);
    assert.equal(day.result.bestProvider, null);
  }
});

test("composição troca somente o Trivago do Curi e preserva todas as outras fontes", async () => {
  const mock = new MockPricingProvider();
  const mockDays = await mock.search(params, [hotel, competitor]);
  const realProvider = createProvider([
    {
      kind: "success",
      offers: [
        {
          providerName: "Expedia",
          priceText: "R$ 224",
          roomName: null,
          attributes: [],
        },
      ],
    },
  ]);
  const hybrid = new HybridPricingProvider(
    mock,
    new Map(),
    new Map([[hotel.slug, realProvider]]),
  );
  const hybridDays = await hybrid.search(params, [hotel, competitor]);

  assert.equal(hybridDays[0].hotels[0].trivago.bestPrice, 224);
  assert.deepEqual(
    hybridDays[0].hotels[0].officialSite,
    mockDays[0].hotels[0].officialSite,
  );
  assert.deepEqual(
    hybridDays[0].hotels[1].trivago,
    mockDays[0].hotels[1].trivago,
  );
});
