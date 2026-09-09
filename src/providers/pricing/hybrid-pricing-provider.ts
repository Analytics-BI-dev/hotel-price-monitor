import type {
  OfficialSitePricingProvider,
  PricingProvider,
  TrivagoPricingSourceProvider,
} from "@/providers/pricing/types";
import type {
  PricingSource,
  PricingHotel,
  ProviderDailyResult,
  SourceResult,
  ValidatedPricingSearch,
} from "@/types/pricing";
import { getStayDates } from "../../services/pricing/validation.ts";
import { logPricing } from "../../services/pricing/logger.ts";

async function searchSource(
  source: PricingSource,
  provider: OfficialSitePricingProvider | TrivagoPricingSourceProvider,
  params: ValidatedPricingSearch,
  hotel: PricingHotel,
): Promise<Map<string, SourceResult>> {
  const startedAt = performance.now();
  const context = {
    hotelSlug: hotel.slug,
    source,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: params.adults,
    durationMs: 0,
  };
  logPricing("PRICING_PROVIDER_START", context);
  const results = new Map<string, SourceResult>();
  let category: "provider_exception" | "invalid_provider_result" | undefined;
  try {
    for (const day of await provider.search(params, hotel)) {
      if (day.result.source === source) results.set(day.date, day.result);
    }
  } catch {
    category = "provider_exception";
  }

  const expectedResults = new Map<string, SourceResult>();
  for (const date of getStayDates(params.checkIn, params.nights)) {
    const result = results.get(date);
    if (result) {
      expectedResults.set(date, result);
    } else {
      category ??= "invalid_provider_result";
      expectedResults.set(date, {
        source,
        status: "error",
        bestPrice: null,
        bestProvider: null,
        searchUrl: null,
        offers: [],
      });
    }
  }
  const values = [...expectedResults.values()];
  const errorCount = values.filter((result) => result.status === "error").length;
  logPricing(errorCount > 0 ? "PRICING_PROVIDER_ERROR" : "PRICING_PROVIDER_SUCCESS", {
    ...context,
    durationMs: performance.now() - startedAt,
    errorCount,
    successCount: values.filter((result) => result.status === "success").length,
    category,
  });
  return expectedResults;
}

export class HybridPricingProvider implements PricingProvider {
  readonly name = "hybrid";
  private readonly fallbackProvider: PricingProvider;
  private readonly officialSiteProviders: ReadonlyMap<
    string,
    OfficialSitePricingProvider
  >;
  private readonly trivagoProviders: ReadonlyMap<
    string,
    TrivagoPricingSourceProvider
  >;

  constructor(
    fallbackProvider: PricingProvider,
    officialSiteProviders: ReadonlyMap<string, OfficialSitePricingProvider>,
    trivagoProviders: ReadonlyMap<string, TrivagoPricingSourceProvider> = new Map(),
  ) {
    this.fallbackProvider = fallbackProvider;
    this.officialSiteProviders = officialSiteProviders;
    this.trivagoProviders = trivagoProviders;
  }

  async search(
    params: ValidatedPricingSearch,
    hotels: PricingHotel[],
  ): Promise<ProviderDailyResult[]> {
    const fallbackDays = await this.fallbackProvider.search(params, hotels);
    const configuredOfficialHotels = hotels.filter(
      (hotel) =>
        hotel.official_site_enabled && this.officialSiteProviders.has(hotel.slug),
    );
    const configuredTrivagoHotels = hotels.filter(
      (hotel) => hotel.trivago_enabled && this.trivagoProviders.has(hotel.slug),
    );
    const [realOfficialResults, realTrivagoResults] = await Promise.all([
      Promise.all(configuredOfficialHotels.map(async (hotel) => {
        const provider = this.officialSiteProviders.get(hotel.slug);
        const results = provider
          ? await searchSource("official_site", provider, params, hotel)
          : new Map<string, SourceResult>();
        return [hotel.slug, results] as const;
      })),
      Promise.all(configuredTrivagoHotels.map(async (hotel) => {
        const provider = this.trivagoProviders.get(hotel.slug);
        const results = provider
          ? await searchSource("trivago", provider, params, hotel)
          : new Map<string, SourceResult>();
        return [hotel.slug, results] as const;
      })),
    ]);
    const officialResultByHotel = new Map(realOfficialResults);
    const trivagoResultByHotel = new Map(realTrivagoResults);

    return fallbackDays.map((day) => ({
      ...day,
      hotels: day.hotels.map((hotel) => {
        const realOfficialSite = officialResultByHotel
          .get(hotel.hotelSlug)
          ?.get(day.date);
        const realTrivago = trivagoResultByHotel
          .get(hotel.hotelSlug)
          ?.get(day.date);

        return {
          ...hotel,
          ...(realOfficialSite ? { officialSite: realOfficialSite } : {}),
          ...(realTrivago ? { trivago: realTrivago } : {}),
        };
      }),
    }));
  }
}
