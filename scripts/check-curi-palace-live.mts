import { CuriPalaceOfficialProvider } from "../src/providers/pricing/official-sites/curi-palace.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const baseDate = process.env.CURI_PALACE_TEST_CHECKIN
  ?? addDays(todayInSaoPaulo(), 4);
const otherDate = addDays(baseDate, 7);
const cases = [
  { id: "A", checkIn: baseDate, checkOut: addDays(baseDate, 1), adults: 1 },
  { id: "B", checkIn: baseDate, checkOut: addDays(baseDate, 1), adults: 2 },
  { id: "C", checkIn: otherDate, checkOut: addDays(otherDate, 1), adults: 1 },
  { id: "D", checkIn: otherDate, checkOut: addDays(otherDate, 1), adults: 2 },
] as const;
const hotel: PricingHotel = {
  id: "live-check-curi-palace",
  name: "Curi Palace Hotel",
  slug: "curi-palace-hotel",
  is_reference_hotel: false,
  official_site_enabled: true,
  official_site_url: "https://www.curipalacehotel.com.br/",
  trivago_enabled: true,
  trivago_property_id: null,
};
const provider = new CuriPalaceOfficialProvider();
const output = [];

for (const testCase of cases) {
  const params: ValidatedPricingSearch = {
    checkIn: testCase.checkIn,
    checkOut: testCase.checkOut,
    adults: testCase.adults,
    rooms: 1,
    children: 0,
    nights: 1,
  };
  const [day] = await provider.search(params, hotel);

  output.push({
    test: testCase.id,
    checkIn: testCase.checkIn,
    checkOut: testCase.checkOut,
    adults: testCase.adults,
    status: day.result.status,
    bestPrice: day.result.bestPrice,
    offerCount: day.result.offers.length,
    offers: day.result.offers.map((offer) => ({
      roomName: offer.roomName,
      price: offer.price,
      breakfastIncluded: offer.breakfastIncluded,
      refundable: offer.refundable,
    })),
    searchUrl: day.result.searchUrl,
  });
}

console.log(JSON.stringify(output, null, 2));
