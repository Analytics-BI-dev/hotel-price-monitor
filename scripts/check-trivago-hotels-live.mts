import {
  trivagoHotelConfigs,
} from "../src/providers/pricing/trivago/hotel-configs.ts";
import {
  createTrivagoProviderMap,
  trivagoBrowserLimiter,
} from "../src/providers/pricing/trivago/trivago-pricing-provider.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function readArgument(name: string, fallback: string): string {
  return (
    process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split(
      "=",
      2,
    )[1] ?? fallback
  );
}

const checkIn = readArgument("check-in", addDays(new Date().toISOString().slice(0, 10), 10));
const nights = Number(readArgument("nights", "1"));
const adults = Number(readArgument("adults", "1"));
const hotelFilters = readArgument("hotel", "")
  .split(",")
  .filter(Boolean);
const compactOutput = readArgument("compact", "false") === "true";
if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
  throw new Error("Use --check-in=AAAA-MM-DD.");
}
if (!Number.isInteger(nights) || nights < 1 || nights > 10) {
  throw new Error("Use --nights entre 1 e 10.");
}
if (!Number.isInteger(adults) || adults < 1 || adults > 2) {
  throw new Error("Use --adults=1 ou --adults=2.");
}

process.env.NODE_ENV = "development";
const traces = new Map<string, Record<string, unknown>>();
const originalInfo = console.info;
console.info = (event?: unknown, details?: unknown) => {
  if (
    typeof event === "string" &&
    typeof details === "object" &&
    details !== null &&
    "hotelSlug" in details
  ) {
    const hotelSlug = String(
      (details as Record<string, unknown>).hotelSlug ?? "",
    );
    const checkIn = String(
      (details as Record<string, unknown>).checkIn ?? "",
    );
    const traceKey = `${hotelSlug}|${checkIn}`;
    const current = traces.get(traceKey) ?? {};
    if (event === "TRIVAGO_GRAPHQL_STATUS") {
      traces.set(traceKey, {
        ...current,
        graphqlHttpStatus: (details as Record<string, unknown>).httpStatus,
        propertyFound: (details as Record<string, unknown>).propertyFound,
        graphqlOffersCount: (details as Record<string, unknown>).offersCount,
        unmappedAdvertisers: (details as Record<string, unknown>)
          .unmappedAdvertisers,
      });
    }
    if (event === "TRIVAGO_OFFERS_PARSED") {
      traces.set(traceKey, {
        ...current,
        domUsed: (details as Record<string, unknown>).domUsed,
        expansionUsed: (details as Record<string, unknown>).expansionUsed,
      });
    }
  }
};

const providers = createTrivagoProviderMap(trivagoHotelConfigs);
const params: ValidatedPricingSearch = {
  checkIn,
  checkOut: addDays(checkIn, nights),
  adults,
  rooms: 1,
  children: 0,
  nights,
};
const startedAt = Date.now();

const hotels = await Promise.all(
  trivagoHotelConfigs
    .filter(
      (config) =>
        hotelFilters.length === 0 || hotelFilters.includes(config.hotelSlug),
    )
    .map(async (config, index) => {
    const hotel: PricingHotel = {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: config.hotelName,
      slug: config.hotelSlug,
      is_reference_hotel: index === 0,
      official_site_enabled: config.hotelSlug !== "jacques-georges-business",
      official_site_url: null,
      trivago_enabled: true,
      trivago_property_id: config.propertyId,
    };
    const provider = providers.get(config.hotelSlug);
    if (!provider) throw new Error(`Provider ausente: ${config.hotelSlug}`);
    const hotelStartedAt = Date.now();
    const days = await provider.search(params, hotel);

    return {
      hotelSlug: config.hotelSlug,
      propertyId: config.propertyId,
      durationMs: Date.now() - hotelStartedAt,
      days: days.map(({ date, result }) => ({
        date,
        trace: traces.get(`${config.hotelSlug}|${date}`) ?? null,
        status: result.status,
        offerCount: result.offers.length,
        bestPrice: result.bestPrice,
        bestProvider: result.bestProvider,
        offers: result.offers.map((offer) => ({
          providerName: offer.providerName,
          price: offer.price,
          roomName: offer.roomName,
          rateName: offer.rateName ?? null,
          detailsText: offer.detailsText ?? null,
          breakfastIncluded: offer.breakfastIncluded,
          refundable: offer.refundable ?? null,
        })),
        searchUrl: result.searchUrl,
      })),
    };
    }),
);

console.info = originalInfo;
const outputHotels = compactOutput
  ? hotels.map((hotel) => ({
      hotelSlug: hotel.hotelSlug,
      propertyId: hotel.propertyId,
      durationMs: hotel.durationMs,
      successCount: hotel.days.filter((day) => day.status === "success").length,
      unavailableCount: hotel.days.filter(
        (day) => day.status === "unavailable",
      ).length,
      errorCount: hotel.days.filter((day) => day.status === "error").length,
      manualVerificationCount: hotel.days.filter(
        (day) => day.status === "manual_verification_required",
      ).length,
      graphql200Count: hotel.days.filter(
        (day) => day.trace?.graphqlHttpStatus === 200,
      ).length,
      exactPropertyCount: hotel.days.filter(
        (day) => day.trace?.propertyFound === true,
      ).length,
      domUsedCount: hotel.days.filter((day) => day.trace?.domUsed === true)
        .length,
      expansionUsedCount: hotel.days.filter(
        (day) => day.trace?.expansionUsed === true,
      ).length,
      totalOffers: hotel.days.reduce(
        (total, day) => total + day.offerCount,
        0,
      ),
      firstDay: hotel.days[0] ?? null,
    }))
  : hotels;
console.log(
  JSON.stringify(
    {
      scenario: params,
      durationMs: Date.now() - startedAt,
      concurrency: trivagoBrowserLimiter.snapshot(),
      hotels: outputHotels,
    },
    null,
    2,
  ),
);
