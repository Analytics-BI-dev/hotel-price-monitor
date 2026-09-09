import type { PricingSource } from "@/types/pricing";

type PricingEvent =
  | "PRICING_SEARCH_START"
  | "PRICING_SEARCH_SUCCESS"
  | "PRICING_SEARCH_ERROR"
  | "PRICING_PROVIDER_START"
  | "PRICING_PROVIDER_SUCCESS"
  | "PRICING_PROVIDER_ERROR";

export interface PricingLogContext {
  hotelSlug: string;
  source: PricingSource | "all";
  checkIn: string;
  checkOut: string;
  adults: number;
  durationMs: number;
  errorCount?: number;
  successCount?: number;
  category?: "provider_exception" | "invalid_provider_result" | "search_failed";
}

// Explicit fields keep credentials, request headers and raw errors out of logs.
export function logPricing(event: PricingEvent, context: PricingLogContext): void {
  const record = {
    event,
    hotelSlug: context.hotelSlug,
    source: context.source,
    checkIn: context.checkIn,
    checkOut: context.checkOut,
    adults: context.adults,
    durationMs: Math.max(0, Math.round(context.durationMs)),
    ...(context.errorCount !== undefined ? { errorCount: context.errorCount } : {}),
    ...(context.successCount !== undefined ? { successCount: context.successCount } : {}),
    ...(context.category ? { category: context.category } : {}),
  };
  if (event.endsWith("_ERROR")) console.error(JSON.stringify(record));
  else console.info(JSON.stringify(record));
}
