import "server-only";

import type { TrivagoDailyResult, TrivagoPricingSourceProvider } from "../types.ts";
import type { PricingHotel, SourceResult, ValidatedPricingSearch } from "../../../types/pricing.ts";
import { addDays, getStayDates } from "../../../services/pricing/validation.ts";
import { buildTrivagoSearchUrl, type TrivagoHotelConfig } from "./hotel-configs.ts";
import { TrivagoJsonRepository } from "./trivago-json-repository.ts";

export class TrivagoJsonPricingProvider implements TrivagoPricingSourceProvider {
  readonly hotelSlug: string;
  private readonly config: TrivagoHotelConfig;
  private readonly repository: TrivagoJsonRepository;

  constructor(config: TrivagoHotelConfig, repository: TrivagoJsonRepository) {
    this.hotelSlug = config.hotelSlug;
    this.config = config;
    this.repository = repository;
  }

  async search(params: ValidatedPricingSearch, hotel: PricingHotel): Promise<TrivagoDailyResult[]> {
    return Promise.all(getStayDates(params.checkIn, params.nights).map(async (date) => {
      const result: SourceResult = {
        source: "trivago", status: "unavailable", bestPrice: null, bestProvider: null, offers: [],
        searchUrl: buildTrivagoSearchUrl({ checkIn: date, checkOut: addDays(date, 1), adults: params.adults }, this.config),
      };
      if (!hotel.trivago_enabled || hotel.slug !== this.hotelSlug) return { date, result };
      try {
        const snapshot = await this.repository.lookup(this.config.hotelName, date, params.adults);
        result.offers = (snapshot?.offers ?? []).map((offer, index) => ({
          id: `trivago-${this.hotelSlug}-${date}-${params.adults}-${index}`,
          source: "trivago", providerName: offer.providerName, price: offer.price,
          currency: "BRL", roomName: null, breakfastIncluded: null,
        }));
        if (result.offers.length) {
          result.status = "success";
          result.bestPrice = result.offers[0].price;
          result.bestProvider = result.offers[0].providerName;
        }
        console.info(JSON.stringify({
          event: "TRIVAGO_JSON_LOOKUP", hotelSlug: this.hotelSlug, date, adults: params.adults,
          snapshotExecution: snapshot?.execution ?? null, offersCount: result.offers.length,
        }));
      } catch {
        result.status = "error";
      }
      return { date, result };
    }));
  }
}

export function createTrivagoJsonProviderMap(
  configs: readonly TrivagoHotelConfig[],
  repository: TrivagoJsonRepository,
): Map<string, TrivagoPricingSourceProvider> {
  return new Map(configs.map((config) => [config.hotelSlug, new TrivagoJsonPricingProvider(config, repository)]));
}
