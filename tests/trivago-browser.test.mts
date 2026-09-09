import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { chromium, type Browser, type Route } from "playwright";

import { TrivagoPricingProvider } from "../src/providers/pricing/trivago/trivago-pricing-provider.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

const params: ValidatedPricingSearch = {
  checkIn: "2026-09-10", checkOut: "2026-09-11", adults: 1, rooms: 1, children: 0, nights: 1,
};
const hotel: PricingHotel = {
  id: "test", name: "Hotel Curi Executive", slug: "hotel-curi-executive",
  is_reference_hotel: true, official_site_enabled: true, official_site_url: null,
  trivago_enabled: true, trivago_property_id: "2436946",
};
const config = { propertyId: "2436946", hotelName: hotel.name, hotelSlug: hotel.slug, retryDelaysMs: [0, 0] };

test("Chromium ausente gera browser_not_installed sem retry ou mensagem sensível", async (t) => {
  let launches = 0;
  const logs: unknown[][] = [];
  t.mock.method(console, "info", (...args: unknown[]) => logs.push(args));
  t.mock.method(chromium, "launch", async () => {
    launches += 1;
    throw new Error("Executable doesn't exist at confidential-local-path; synthetic-secret");
  });
  const [day] = await new TrivagoPricingProvider(config).search(params, hotel);
  assert.equal(day.result.status, "error");
  assert.equal(launches, 1);
  assert.match(JSON.stringify(logs), /browser_not_installed/);
  assert.doesNotMatch(JSON.stringify(logs), /confidential-local-path|synthetic-secret/);
});

for (const complete of [true, false]) {
  test(complete
    ? "GraphQL suficiente retorna preço sem ler card e fecha page/context/browser"
    : "GraphQL parcial válida sobrevive à ausência de card DOM e fecha todos os recursos", async (t) => {
    const closed = { page: 0, context: 0, browser: 0 };
    const events = new EventEmitter();
    let routeHandler: ((route: Route) => Promise<void>) | undefined;
    let cardReads = 0;
    let fetchSignal: AbortSignal | undefined;
    const deal = {
      id: "expedia", advertiserDetails: { nsid: { ns: 400, id: 406 } },
      accommodationDetails: { nsid: { ns: 100, id: 2436946 } },
      allInPricePerNight: { amount: 224 },
    };
    const payload = { data: { accommodationSearchResponse: { accommodations: [{
      nsid: { ns: 100, id: 2436946 },
      deals: { best: deal, alternatives: [], ...(complete ? { cheapest: deal } : {}) },
    }] } } };
    t.mock.method(console, "info", () => undefined);
    t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("cookie"), false);
      assert.equal(headers.has("authorization"), false);
      fetchSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify(payload));
    });
    const missing = {
      first() { return this; },
      async count() { return 0; },
      async waitFor() { throw new Error("Card ausente no teste"); },
    };
    const page = {
      once: events.once.bind(events),
      setDefaultTimeout() {},
      async route(_pattern: RegExp, handler: typeof routeHandler) { routeHandler = handler; },
      async goto() {
        assert.ok(routeHandler);
        await routeHandler({
          request: () => ({
            url: () => "https://www.trivago.com.br/graphql?accommodationSearchQuery",
            postData: () => JSON.stringify({ ns: 100, id: 2436946 }),
            method: () => "POST",
            allHeaders: async () => ({ cookie: "synthetic-cookie", authorization: "synthetic-auth", accept: "application/json" }),
          }),
          fulfill: async () => undefined,
        } as unknown as Route);
        return { status: () => 200, ok: () => true };
      },
      locator(selector: string) {
        if (selector === "body") return { innerText: async () => "Trivago Hotel Curi Executive" };
        cardReads += 1;
        return missing;
      },
      getByText: () => missing,
      async close() { closed.page += 1; events.emit("close"); },
    };
    t.mock.method(chromium, "launch", async () => ({
      newContext: async () => ({ newPage: async () => page, close: async () => { closed.context += 1; } }),
      close: async () => { closed.browser += 1; },
    }) as unknown as Browser);

    const [day] = await new TrivagoPricingProvider({ ...config, graphqlTimeoutMs: 5, parsingTimeoutMs: 5 }).search(params, hotel);
    assert.equal(day.result.status, "success");
    assert.equal(day.result.bestPrice, 224);
    assert.equal(day.result.bestProvider, "Expedia");
    assert.equal(day.result.offers.length, 1);
    assert.deepEqual(closed, { page: 1, context: 1, browser: 1 });
    assert.equal(fetchSignal?.aborted, true);
    assert.equal(cardReads, complete ? 0 : 1);
  });
}
