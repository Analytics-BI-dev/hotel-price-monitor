import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { PricingHotel } from "@/types/pricing";

export async function getActiveHotels(): Promise<PricingHotel[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hotels")
    .select(
      "id, name, slug, is_reference_hotel, official_site_enabled, official_site_url, trivago_enabled, trivago_property_id",
    )
    .eq("active", true)
    .order("is_reference_hotel", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Não foi possível carregar os hotéis: ${error.message}`);
  }

  return data;
}

