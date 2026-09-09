import assert from "node:assert/strict";
import test from "node:test";

import {
  trivagoHotelConfigs,
} from "../src/providers/pricing/trivago/hotel-configs.ts";
import {
  createTrivagoProviderMap,
  resolveTrivagoMaxConcurrency,
  TrivagoConcurrencyLimiter,
  buildTrivagoSearchUrl,
  TrivagoPricingProvider,
} from "../src/providers/pricing/trivago/trivago-pricing-provider.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

const expectedProperties = new Map([
  ["hotel-curi-executive", "2436946"],
  ["curi-palace-hotel", "1180090"],
  ["hotel-alles-blau", "7770070"],
  ["jacques-georges-tower", "3387958"],
  ["jacques-georges-business", "3487706"],
  ["ibis-pelotas", "48115946"],
  ["m-tower-hotel", "2899803"],
]);

const params: ValidatedPricingSearch = {
  checkIn: "2026-09-10",
  checkOut: "2026-09-11",
  adults: 1,
  rooms: 1,
  children: 0,
  nights: 1,
};

function pricingHotel(
  config: (typeof trivagoHotelConfigs)[number],
  propertyId = config.propertyId,
): PricingHotel {
  return {
    id: `00000000-0000-4000-8000-${propertyId.padStart(12, "0")}`,
    name: config.hotelName,
    slug: config.hotelSlug,
    is_reference_hotel: config.hotelSlug === "hotel-curi-executive",
    official_site_enabled: config.hotelSlug !== "jacques-georges-business",
    official_site_url: null,
    trivago_enabled: true,
    trivago_property_id: propertyId,
  };
}

test("registra os sete hotéis com os property IDs corretos", () => {
  assert.equal(trivagoHotelConfigs.length, 7);
  assert.equal(createTrivagoProviderMap(trivagoHotelConfigs).size, 7);
  assert.deepEqual(
    new Map(
      trivagoHotelConfigs.map(({ hotelSlug, propertyId }) => [
        hotelSlug,
        propertyId,
      ]),
    ),
    expectedProperties,
  );
});

test("monta uma URL inequívoca para cada hotel, data e ocupação", () => {
  for (const config of trivagoHotelConfigs) {
    const oneAdult = new URL(buildTrivagoSearchUrl(params, config));
    const twoAdults = new URL(
      buildTrivagoSearchUrl({ ...params, adults: 2 }, config),
    );

    assert.equal(oneAdult.hostname, "www.trivago.com.br");
    assert.match(oneAdult.pathname, new RegExp(config.searchPathSlug));
    assert.equal(
      oneAdult.searchParams.get("search"),
      `100-${config.propertyId};dr-20260910-20260911;drs-40;rc-1-1`,
    );
    assert.equal(
      twoAdults.searchParams.get("search"),
      `100-${config.propertyId};dr-20260910-20260911;drs-40;rc-1-2`,
    );
  }
});

test("cada provider rejeita slug ou property ID de outro hotel antes da coleta", async () => {
  for (const config of trivagoHotelConfigs) {
    let collectorCalls = 0;
    const provider = new TrivagoPricingProvider({
      ...config,
      collector: async () => {
        collectorCalls += 1;
        return [{ kind: "unavailable" }];
      },
    });
    const [day] = await provider.search(
      params,
      pricingHotel(config, `${config.propertyId}9`),
    );

    assert.equal(day.result.status, "error");
    assert.equal(collectorCalls, 0);
  }
});

test("o mesmo provider genérico calcula bestPrice e bestProvider para os sete hotéis", async () => {
  for (const config of trivagoHotelConfigs) {
    const provider = new TrivagoPricingProvider({
      ...config,
      collector: async () => [
        {
          kind: "success",
          offers: [
            {
              providerName: "Booking.com",
              priceText: "R$ 280",
              roomName: null,
              attributes: [],
            },
            {
              providerName: "Expedia",
              priceText: "R$ 245",
              roomName: null,
              attributes: [],
            },
          ],
        },
      ],
    });
    const [day] = await provider.search(params, pricingHotel(config));

    assert.equal(day.result.status, "success");
    assert.equal(day.result.bestPrice, 245);
    assert.equal(day.result.bestProvider, "Expedia");
    assert.equal(day.result.offers.length, 2);
  }
});

test("o limitador respeita o teto global e libera toda a fila", async () => {
  const limiter = new TrivagoConcurrencyLimiter(2);
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  let firstPairStarted: (() => void) | undefined;
  const firstPair = new Promise<void>((resolve) => {
    firstPairStarted = resolve;
  });

  const tasks = Array.from({ length: 5 }, () =>
    limiter.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      if (running === 2) firstPairStarted?.();
      await new Promise<void>((resolve) => releases.push(resolve));
      running -= 1;
    }),
  );

  await firstPair;
  assert.deepEqual(limiter.snapshot(), {
    active: 2,
    queued: 3,
    limit: 2,
    peak: 2,
  });

  while (releases.length > 0 || limiter.snapshot().queued > 0) {
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(tasks);

  assert.equal(peak, 2);
  assert.equal(limiter.snapshot().active, 0);
  assert.equal(limiter.snapshot().queued, 0);
});

test("a configuração nunca permite mais de três navegadores simultâneos", () => {
  assert.equal(resolveTrivagoMaxConcurrency(undefined), 3);
  assert.equal(resolveTrivagoMaxConcurrency("2"), 2);
  assert.equal(resolveTrivagoMaxConcurrency("70"), 3);
  assert.equal(resolveTrivagoMaxConcurrency("invalido"), 3);
});
