import type { Hotel } from "@/types/database";

export type PricingSource = "official_site" | "trivago";
export type PricingStatus =
  | "loading"
  | "success"
  | "unavailable"
  | "link_only"
  | "manual_verification_required"
  | "error";

export interface ManualVerificationContext {
  mode: "human_in_the_loop";
  reason: "captcha_required";
}

export interface HotelOffer {
  id: string;
  source: PricingSource;
  providerName: string | null;
  roomName: string | null;
  rateName?: string | null;
  detailsText?: string | null;
  breakfastIncluded: boolean | null;
  refundable?: boolean | null;
  offerUrl?: string | null;
  price: number;
  currency: "BRL";
}

export interface SourceResult {
  source: PricingSource;
  status: PricingStatus;
  bestPrice: number | null;
  bestProvider: string | null;
  searchUrl: string | null;
  offers: HotelOffer[];
  manualVerification?: ManualVerificationContext;
}

export interface PricingSearchInput {
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: 1;
  children: 0;
}

export interface ValidatedPricingSearch extends PricingSearchInput {
  nights: number;
}

export type PricingHotel = Pick<
  Hotel,
  | "id"
  | "name"
  | "slug"
  | "is_reference_hotel"
  | "official_site_enabled"
  | "official_site_url"
  | "trivago_enabled"
  | "trivago_property_id"
>;

export interface ProviderHotelRate {
  hotelId: string;
  hotelName: string;
  hotelSlug: string;
  isReferenceHotel: boolean;
  date: string;
  officialSite: SourceResult;
  trivago: SourceResult;
}

export interface ProviderDailyResult {
  date: string;
  checkoutDate: string;
  hotels: ProviderHotelRate[];
}

export interface PriceComparison {
  differenceValue: number;
  differencePercent: number;
}

export interface DailyHotelRate extends ProviderHotelRate {
  competitivePrice: number | null;
  comparisonBySource: Record<PricingSource, PriceComparison | null>;
}

export interface DailyPricingResult {
  date: string;
  checkoutDate: string;
  hotels: DailyHotelRate[];
}

export interface DailyStrategyPoint {
  date: string;
  status: "success" | "unavailable";
  referencePrice: number | null;
  cheapestCompetitorName: string | null;
  cheapestCompetitorPrice: number | null;
  differenceValue: number | null;
  differencePercent: number | null;
}

export interface PricingSummary {
  analyzedDays: number;
  referenceMoreExpensiveDays: number;
  referenceCheaperDays: number;
  largestDifference: {
    value: number;
    date: string;
  } | null;
}

export interface PricingSearchResult {
  params: ValidatedPricingSearch;
  days: DailyPricingResult[];
  strategy: DailyStrategyPoint[];
  summary: PricingSummary;
}

export interface PricingActionState {
  status: "idle" | "error" | "success";
  message: string;
  result: PricingSearchResult | null;
}
