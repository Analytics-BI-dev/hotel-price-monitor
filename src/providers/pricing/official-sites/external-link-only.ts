import "server-only";

import type {
  OfficialSiteDailyResult,
  OfficialSitePricingProvider,
} from "@/providers/pricing/types";
import type {
  PricingHotel,
  ValidatedPricingSearch,
} from "@/types/pricing";

function getStayDates(checkIn: string, nights: number): string[] {
  return Array.from({ length: nights }, (_, index) => {
    const date = new Date(`${checkIn}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export interface ExternalLinkOnlyOfficialHotelConfig {
  hotelSlug: string;
  reservationBaseUrl: string;
}

export const externalLinkOnlyOfficialHotelConfigs = [
  {
    hotelSlug: "hotel-alles-blau",
    reservationBaseUrl:
      "https://reservas.desbravador.com.br/hotel-app/hotel-alles-blau/reservation",
  },
  {
    hotelSlug: "jacques-georges-tower",
    reservationBaseUrl:
      "https://reservas.desbravador.com.br/hotel-app/hotel-jacques-georges-tower/reservation",
  },
  {
    hotelSlug: "m-tower-hotel",
    reservationBaseUrl:
      "https://reservas.desbravador.com.br/hotel-app/m-tower-hotel/reservation",
  },
] as const satisfies readonly ExternalLinkOnlyOfficialHotelConfig[];

export function buildExternalOfficialSearchUrl(
  config: ExternalLinkOnlyOfficialHotelConfig,
  params: Pick<ValidatedPricingSearch, "checkIn" | "checkOut" | "adults">,
): string {
  const url = new URL(config.reservationBaseUrl);
  url.searchParams.set("checkin", params.checkIn);
  url.searchParams.set("checkout", params.checkOut);
  url.searchParams.set("adults", String(params.adults));
  url.searchParams.set("child1", "0");
  url.searchParams.set("child2", "0");
  url.searchParams.set("child3", "0");
  url.searchParams.set("voucher", "");
  url.searchParams.set("resident", "0");
  return url.toString();
}

export class ExternalLinkOnlyOfficialProvider
  implements OfficialSitePricingProvider
{
  readonly hotelSlug: string;
  private readonly config: ExternalLinkOnlyOfficialHotelConfig;

  constructor(config: ExternalLinkOnlyOfficialHotelConfig) {
    this.config = config;
    this.hotelSlug = config.hotelSlug;
  }

  async search(
    params: ValidatedPricingSearch,
    hotel: PricingHotel,
  ): Promise<OfficialSiteDailyResult[]> {
    void hotel;
    const searchUrl = buildExternalOfficialSearchUrl(this.config, params);

    return getStayDates(params.checkIn, params.nights).map((date) => ({
      date,
      result: {
        source: "official_site",
        status: "link_only",
        bestPrice: null,
        bestProvider: null,
        searchUrl,
        offers: [],
      },
    }));
  }
}
