import { IbisPelotasOfficialProvider } from "../src/providers/pricing/official-sites/ibis-pelotas.ts";
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

const baseDate = process.env.IBIS_PELOTAS_TEST_CHECKIN
  ?? addDays(todayInSaoPaulo(), 4);
const otherDate = addDays(baseDate, 7);
const multiOfferDate = addDays(baseDate, 14);
const cases = [
  { id: "A", checkIn: baseDate, checkOut: addDays(baseDate, 1), adults: 1 },
  { id: "B", checkIn: baseDate, checkOut: addDays(baseDate, 1), adults: 2 },
  { id: "C", checkIn: otherDate, checkOut: addDays(otherDate, 1), adults: 1 },
  { id: "D", checkIn: otherDate, checkOut: addDays(otherDate, 1), adults: 2 },
  { id: "E", checkIn: multiOfferDate, checkOut: addDays(multiOfferDate, 1), adults: 1 },
  { id: "F", checkIn: baseDate, checkOut: addDays(baseDate, 2), adults: 1 },
] as const;
const hotel: PricingHotel = {
  id: "live-check-ibis-pelotas",
  name: "ibis Pelotas",
  slug: "ibis-pelotas",
  is_reference_hotel: false,
  official_site_enabled: true,
  official_site_url: "https://ibispelotas.atriohoteis.com.br/",
  trivago_enabled: true,
  trivago_property_id: null,
};
const provider = new IbisPelotasOfficialProvider();
const output = [];

for (const testCase of cases) {
  const nights = Math.round(
    (new Date(`${testCase.checkOut}T00:00:00Z`).getTime()
      - new Date(`${testCase.checkIn}T00:00:00Z`).getTime())
      / 86_400_000,
  );
  const params: ValidatedPricingSearch = {
    checkIn: testCase.checkIn,
    checkOut: testCase.checkOut,
    adults: testCase.adults,
    rooms: 1,
    children: 0,
    nights,
  };
  const days = await provider.search(params, hotel);

  output.push({
    test: testCase.id,
    checkIn: testCase.checkIn,
    checkOut: testCase.checkOut,
    adults: testCase.adults,
    days: days.map((day) => ({
      date: day.date,
      status: day.result.status,
      bestPrice: day.result.bestPrice,
      offerCount: day.result.offers.length,
      offers: day.result.offers.map((item) => ({
        roomName: item.roomName,
        price: item.price,
        breakfastIncluded: item.breakfastIncluded,
        refundable: item.refundable,
      })),
      searchUrl: day.result.searchUrl,
    })),
  });
}

console.log(JSON.stringify(output, null, 2));
