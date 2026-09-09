import { HybridPricingProvider } from "../src/providers/pricing/hybrid-pricing-provider.ts";
import { MockPricingProvider } from "../src/providers/pricing/mock/mock-pricing-provider.ts";
import { CuriExecutiveOfficialProvider } from "../src/providers/pricing/official-sites/curi-executive.ts";
import { TrivagoPricingProvider } from "../src/providers/pricing/trivago/trivago-pricing-provider.ts";
import { buildPricingResult } from "../src/services/pricing/calculations.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

process.env.NODE_ENV = "development";

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

const officialProvider = new CuriExecutiveOfficialProvider();
const trivagoProvider = new TrivagoPricingProvider({
  propertyId: "2436946",
  hotelName: "Hotel Curi Executive",
  hotelSlug: "hotel-curi-executive",
  searchPathSlug: "hotel-curi-executive-pelotas",
});
const dashboardProvider = new HybridPricingProvider(
  new MockPricingProvider(),
  new Map([[officialProvider.hotelSlug, officialProvider]]),
  new Map([[trivagoProvider.hotelSlug, trivagoProvider]]),
);

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

const checkIn = process.env.TRIVAGO_CURI_TEST_CHECKIN
  ?? addDays(new Date().toISOString().slice(0, 10), 10);
const checkOut = addDays(checkIn, 1);
const scenarios = [
  ...Array.from({ length: 5 }, (_, index) => ({
    label: `principal-${index + 1}`,
    checkIn,
    checkOut,
    adults: 1,
  })),
  {
    label: "principal-2-adultos",
    checkIn,
    checkOut,
    adults: 2,
  },
  {
    label: "outra-data-1-adulto",
    checkIn: addDays(checkIn, 7),
    checkOut: addDays(checkOut, 7),
    adults: 1,
  },
];

const originalInfo = console.info.bind(console);
let attempts = 0;
let retries = 0;
let graphqlStatuses: Array<number | null> = [];
let propertyFound = false;
let graphqlOffersCount = 0;
let domUsed = false;
let expansionUsed = false;

console.info = (...values: unknown[]) => {
  const [event, details] = values;
  if (event === "TRIVAGO_ATTEMPT" && typeof details === "object" && details) {
    attempts = Math.max(
      attempts,
      Number((details as Record<string, unknown>).attempt ?? 0),
    );
  }
  if (event === "TRIVAGO_RETRY") retries += 1;
  if (
    event === "TRIVAGO_GRAPHQL_STATUS" &&
    typeof details === "object" &&
    details
  ) {
    const status = (details as Record<string, unknown>).httpStatus;
    graphqlStatuses.push(typeof status === "number" ? status : null);
  }
  if (
    event === "TRIVAGO_SEARCH_SUCCESS" &&
    typeof details === "object" &&
    details
  ) {
    const result = details as Record<string, unknown>;
    propertyFound = result.propertyFound === true;
    graphqlOffersCount = Number(result.graphqlOffersCount ?? 0);
    domUsed = result.domUsed === true;
    expansionUsed = result.expansionUsed === true;
  }
  originalInfo(...values);
};

for (const scenario of scenarios) {
  attempts = 0;
  retries = 0;
  graphqlStatuses = [];
  propertyFound = false;
  graphqlOffersCount = 0;
  domUsed = false;
  expansionUsed = false;
  const startedAt = Date.now();
  const params: ValidatedPricingSearch = {
    checkIn: scenario.checkIn,
    checkOut: scenario.checkOut,
    adults: scenario.adults,
    rooms: 1,
    children: 0,
    nights: 1,
  };
  const providerDays = await dashboardProvider.search(params, [hotel]);
  const result = buildPricingResult(params, providerDays);
  const trivago = result.days[0].hotels[0].trivago;

  originalInfo(
    "TRIVAGO_RESILIENCE_RESULT",
    JSON.stringify({
      label: scenario.label,
      checkIn: scenario.checkIn,
      checkOut: scenario.checkOut,
      adults: scenario.adults,
      status: trivago.status,
      bestPrice: trivago.bestPrice,
      bestProvider: trivago.bestProvider,
      offersCount: trivago.offers.length,
      durationMs: Date.now() - startedAt,
      attempts,
      retries,
      graphqlStatuses,
      propertyFound,
      graphqlOffersCount,
      domUsed,
      expansionUsed,
    }),
  );
}
