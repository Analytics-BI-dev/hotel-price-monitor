import type {
  PricingHotel,
  ProviderDailyResult,
  SourceResult,
  ValidatedPricingSearch,
} from "@/types/pricing";

export interface PricingProvider {
  readonly name: string;
  search(
    params: ValidatedPricingSearch,
    hotels: PricingHotel[],
  ): Promise<ProviderDailyResult[]>;
}

export interface OfficialSiteDailyResult {
  date: string;
  result: SourceResult;
}

export interface OfficialSitePricingProvider {
  readonly hotelSlug: string;
  search(
    params: ValidatedPricingSearch,
    hotel: PricingHotel,
  ): Promise<OfficialSiteDailyResult[]>;
}

export interface TrivagoDailyResult {
  date: string;
  result: SourceResult;
}

export interface TrivagoPricingSourceProvider {
  readonly hotelSlug: string;
  search(
    params: ValidatedPricingSearch,
    hotel: PricingHotel,
  ): Promise<TrivagoDailyResult[]>;
}
