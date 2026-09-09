import { TrivagoPricingProvider } from "../src/providers/pricing/trivago/trivago-pricing-provider.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

const baseDate =
  process.env.TRIVAGO_CURI_TEST_CHECKIN ??
  addDays(new Date().toISOString().slice(0, 10), 10);
const dates = [baseDate, addDays(baseDate, 7)];

const hotel: PricingHotel = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Hotel Curi Executive",
  slug: "hotel-curi-executive",
  is_reference_hotel: true,
  official_site_enabled: true,
  official_site_url: "https://www.hotelcuri.com.br/",
  trivago_enabled: true,
  trivago_property_id: "2436946",
};

const provider = new TrivagoPricingProvider({
  propertyId: "2436946",
  hotelName: "Hotel Curi Executive",
  hotelSlug: "hotel-curi-executive",
  searchPathSlug: "hotel-curi-executive-pelotas",
});

for (const checkIn of dates) {
  for (const adults of [1, 2]) {
    const checkOut = addDays(checkIn, 1);
    const params: ValidatedPricingSearch = {
      checkIn,
      checkOut,
      adults,
      rooms: 1,
      children: 0,
      nights: 1,
    };
    const [day] = await provider.search(params, hotel);

    console.log(
      JSON.stringify(
        {
          checkIn,
          checkOut,
          adults,
          status: day.result.status,
          bestPrice: day.result.bestPrice,
          bestProvider: day.result.bestProvider,
          offerCount: day.result.offers.length,
          offers: day.result.offers.map((offer) => ({
            providerName: offer.providerName,
            price: offer.price,
            roomName: offer.roomName,
            breakfastIncluded: offer.breakfastIncluded,
            refundable: offer.refundable,
          })),
          searchUrl: day.result.searchUrl,
        },
        null,
        2,
      ),
    );
  }
}
