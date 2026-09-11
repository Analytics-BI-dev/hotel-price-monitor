import "server-only";

import { pricingProvider } from "../../providers/pricing/provider-registry.ts";
import { buildPricingResult } from "./calculations.ts";
import { logPricing } from "./logger.ts";
import type {
  PricingHotel,
  PricingSearchResult,
  ValidatedPricingSearch,
} from "@/types/pricing";

export async function searchPricing(
  params: ValidatedPricingSearch,
  hotels: PricingHotel[],
): Promise<PricingSearchResult> {
  const startedAt = performance.now();
  const context = {
    hotelSlug: "all",
    source: "all" as const,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    adults: params.adults,
    durationMs: 0,
  };
  logPricing("PRICING_SEARCH_START", context);
  const referenceHotels = hotels.filter((hotel) => hotel.is_reference_hotel);

  if (referenceHotels.length !== 1) {
    throw new Error("A configuração deve possuir exatamente um hotel de referência.");
  }

  const providerDays = await pricingProvider.search(params, hotels);
  const result = buildPricingResult(params, providerDays);
  logPricing("PRICING_SEARCH_SUCCESS", {
    ...context,
    durationMs: performance.now() - startedAt,
    errorCount: providerDays.flatMap((day) => day.hotels).reduce(
      (count, hotel) => count + Number(hotel.officialSite.status === "error") +
        Number(hotel.trivago.status === "error"), 0,
    ),
  });
  return result;
}
