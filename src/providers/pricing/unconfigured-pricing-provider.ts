import type { PricingProvider } from "@/providers/pricing/types";
import { addDays, getStayDates } from "../../services/pricing/validation.ts";
import type {
  PricingHotel,
  PricingSource,
  ProviderDailyResult,
  SourceResult,
  ValidatedPricingSearch,
} from "@/types/pricing";

function emptySource(source: PricingSource, enabled: boolean): SourceResult {
  return {
    source,
    status: enabled ? "error" : "unavailable",
    bestPrice: null,
    bestProvider: null,
    offers: [],
    searchUrl: null,
  };
}

// Production starts without prices. Only a real provider can supply them.
export class UnconfiguredPricingProvider implements PricingProvider {
  readonly name = "unconfigured";

  async search(
    params: ValidatedPricingSearch,
    hotels: PricingHotel[],
  ): Promise<ProviderDailyResult[]> {
    return getStayDates(params.checkIn, params.nights).map((date) => ({
      date,
      checkoutDate: addDays(date, 1),
      hotels: hotels.map((hotel) => ({
        hotelId: hotel.id,
        hotelName: hotel.name,
        hotelSlug: hotel.slug,
        isReferenceHotel: hotel.is_reference_hotel,
        date,
        officialSite: emptySource("official_site", hotel.official_site_enabled),
        trivago: emptySource("trivago", hotel.trivago_enabled),
      })),
    }));
  }
}
