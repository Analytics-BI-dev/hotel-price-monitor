// Calls the same searchPricing service as the dashboard action, with the real
// production registry. No login, database writes or reservations are performed.
import { searchPricing } from "../src/services/pricing/pricing-service.ts";
import { trivagoHotelConfigs } from "../src/providers/pricing/trivago/hotel-configs.ts";
import { addDays, validatePricingSearch } from "../src/services/pricing/validation.ts";
import type { PricingHotel } from "../src/types/pricing.ts";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [name, value] = arg.replace(/^--/, "").split("=");
  return [name, value];
}));
const checkIn = args.get("check-in") ?? "";
const checkOut = addDays(checkIn, Number(args.get("nights") ?? 1));
const validation = validatePricingSearch({ checkIn, checkOut, adults: Number(args.get("adults") ?? 2), rooms: 1, children: 0 });

if (!process.env.TRIVAGO_JSON_URL?.trim()) {
  console.error("Configure TRIVAGO_JSON_URL no .env.local com uma URL de conteúdo JSON direto.");
  process.exitCode = 1;
} else if (!validation.success) {
  console.error(`${validation.message} Use --check-in=YYYY-MM-DD --nights=1 --adults=2 com uma data disponível no arquivo.`);
  process.exitCode = 1;
} else {
  const hotels: PricingHotel[] = trivagoHotelConfigs.map((config, index) => ({
    id: `live-json-${index}`, name: config.hotelName, slug: config.hotelSlug,
    is_reference_hotel: index === 0, official_site_enabled: config.hotelSlug !== "jacques-georges-business",
    official_site_url: null, trivago_enabled: true, trivago_property_id: config.propertyId,
  }));
  const output = await searchPricing(validation.data, hotels);
  for (const day of output.days) for (const hotel of day.hotels) {
    console.info(JSON.stringify({ date: day.date, hotelSlug: hotel.hotelSlug,
      official: { status: hotel.officialSite.status, bestPrice: hotel.officialSite.bestPrice },
      trivago: { status: hotel.trivago.status, bestPrice: hotel.trivago.bestPrice,
        bestProvider: hotel.trivago.bestProvider, offersCount: hotel.trivago.offers.length, searchUrl: hotel.trivago.searchUrl },
    }));
  }
  if (output.days.some((day) => day.hotels.some((hotel) => hotel.trivago.status === "error"))) process.exitCode = 1;
}
