"use server";

import { requireActiveProfile } from "@/lib/auth/profile";
import { getActiveHotels } from "@/services/hotels/get-active-hotels";
import { searchPricing } from "@/services/pricing/pricing-service";
import { validatePricingSearch } from "@/services/pricing/validation";
import { logPricing } from "@/services/pricing/logger";
import type { PricingActionState, PricingSearchInput } from "@/types/pricing";

export async function searchPricesAction(
  formData: FormData,
): Promise<PricingActionState> {
  await requireActiveProfile();

  const adults = Number(formData.get("adults"));
  const input: PricingSearchInput = {
    checkIn: String(formData.get("checkIn") ?? ""),
    checkOut: String(formData.get("checkOut") ?? ""),
    adults,
    rooms: 1,
    children: 0,
  };
  const validation = validatePricingSearch(input);

  if (!validation.success) {
    return {
      status: "error",
      message: validation.message,
      result: null,
    };
  }

  const startedAt = performance.now();
  try {
    const hotels = await getActiveHotels();
    const result = await searchPricing(validation.data, hotels);

    return {
      status: "success",
      message: "Preços carregados com sucesso.",
      result,
    };
  } catch {
    logPricing("PRICING_SEARCH_ERROR", {
      hotelSlug: "all",
      source: "all",
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults,
      durationMs: performance.now() - startedAt,
      category: "search_failed",
    });

    return {
      status: "error",
      message: "Não foi possível buscar os preços. Tente novamente.",
      result: null,
    };
  }
}
