import type { PricingProvider } from "@/providers/pricing/types";
import type {
  HotelOffer,
  PricingHotel,
  ProviderDailyResult,
  SourceResult,
  ValidatedPricingSearch,
} from "@/types/pricing";

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function getStayDates(checkIn: string, nights: number): string[] {
  return Array.from({ length: nights }, (_, index) => addDays(checkIn, index));
}

const ROOM_NAMES = [
  "Standard Casal",
  "Standard Superior",
  "Luxo",
  "Executivo",
];

const TRIVAGO_PROVIDERS = [
  "Booking.com",
  "Expedia",
  "Hoteis.com",
  "Agoda",
  "Site oficial",
];

const HOTEL_BASE_PRICES: Record<string, number> = {
  "hotel-curi-executive": 318,
  "curi-palace-hotel": 342,
  "hotel-alles-blau": 292,
  "jacques-georges-tower": 374,
  "jacques-georges-business": 278,
  "ibis-pelotas": 326,
  "m-tower-hotel": 358,
};

function hash(value: string): number {
  let result = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }

  return result >>> 0;
}

function seededInteger(key: string, minimum: number, maximum: number): number {
  return minimum + (hash(key) % (maximum - minimum + 1));
}

function clampPrice(price: number): number {
  return Math.min(650, Math.max(220, Math.round(price)));
}

function breakfastFor(key: string): boolean | null {
  const value = seededInteger(key, 0, 4);
  return value === 0 ? null : value % 2 === 0;
}

function hotelBasePrice(hotel: PricingHotel, date: string, adults: number) {
  const configuredBase =
    HOTEL_BASE_PRICES[hotel.slug] ?? seededInteger(hotel.slug, 270, 390);
  const dailyVariation = seededInteger(`${hotel.slug}:${date}`, -42, 54);
  const occupancyAdjustment = adults === 2 ? 58 : 0;

  return clampPrice(configuredBase + dailyVariation + occupancyAdjustment);
}

function sourceResult(
  source: "official_site" | "trivago",
  hotel: PricingHotel,
  date: string,
  adults: number,
): SourceResult {
  const enabled =
    source === "official_site"
      ? hotel.official_site_enabled
      : hotel.trivago_enabled;

  if (!enabled) {
    return {
      source,
      status: "unavailable",
      bestPrice: null,
      bestProvider: null,
      searchUrl: null,
      offers: [],
    };
  }

  const basePrice = hotelBasePrice(hotel, date, adults);
  const count = seededInteger(
    `${source}:${hotel.slug}:${date}:${adults}:count`,
    1,
    source === "official_site" ? 3 : 4,
  );
  const sourceAdjustment = source === "trivago" ? -24 : 0;
  const offers: HotelOffer[] = Array.from({ length: count }, (_, index) => {
    const providerIndex = seededInteger(
      `${hotel.slug}:${date}:${adults}:provider:${index}`,
      0,
      TRIVAGO_PROVIDERS.length - 1,
    );
    const providerName =
      source === "official_site" ? "Site oficial" : TRIVAGO_PROVIDERS[providerIndex];
    const roomName =
      ROOM_NAMES[
        seededInteger(
          `${source}:${hotel.slug}:${date}:${adults}:room:${index}`,
          0,
          ROOM_NAMES.length - 1,
        )
      ];
    const price = clampPrice(
      basePrice +
        sourceAdjustment +
        index * seededInteger(`${hotel.slug}:${date}:step:${index}`, 24, 47) +
        seededInteger(`${source}:${hotel.slug}:${date}:${index}`, -12, 16),
    );

    return {
      id: `${hotel.slug}-${date}-${source}-${index + 1}`,
      source,
      providerName,
      roomName,
      breakfastIncluded: breakfastFor(
        `${source}:${hotel.slug}:${date}:${adults}:breakfast:${index}`,
      ),
      refundable: null,
      offerUrl: null,
      price,
      currency: "BRL" as const,
    };
  }).sort((left, right) => left.price - right.price);

  return {
    source,
    status: "success",
    bestPrice: offers[0]?.price ?? null,
    bestProvider: offers[0]?.providerName ?? null,
    searchUrl: null,
    offers,
  };
}


export class MockPricingProvider implements PricingProvider {
  readonly name = "mock";

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
        officialSite: sourceResult(
          "official_site",
          hotel,
          date,
          params.adults,
        ),
        trivago: sourceResult("trivago", hotel, date, params.adults),
      })),
    }));
  }
}
