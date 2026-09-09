import "server-only";

import type {
  OfficialSiteDailyResult,
  OfficialSitePricingProvider,
} from "@/providers/pricing/types";
import type {
  HotelOffer,
  PricingHotel,
  SourceResult,
  ValidatedPricingSearch,
} from "@/types/pricing";

const IBIS_PELOTAS_SLUG = "ibis-pelotas";
const ACCOR_HOTEL_ID = "B6N3";
const ACCOR_BOOKING_URL =
  "https://all.accor.com/booking/pt-br/accor/hotel/B6N3";
const ACCOR_GRAPHQL_URL = "https://api.accor.com/bff/v1/graphql";
const ACCOR_APP_ID = "all.accor";

type UnknownRecord = Record<string, unknown>;

interface IbisPelotasProviderOptions {
  bookingUrl?: string;
  graphqlUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

class ManualVerificationRequiredError extends Error {
  constructor() {
    super("A Accor passou a exigir verificação humana para esta consulta.");
    this.name = "ManualVerificationRequiredError";
  }
}

const HOTEL_OFFERS_FIELDS = `
  offersSelection(selectionStep: $selectionStep, totalRoomInBasket: $totalRoomInBasket) {
    offers {
      pricing {
        currency
        aggregationType
        formattedTaxType
        main {
          amount
          categories
          simplifiedPolicies {
            cancellation { code label }
          }
        }
      }
      mealPlan { code label }
      lengthOfStay { value unit }
      product { id quantity updatedRemaining }
      rate { id label legacyId }
      occupancy { adults childrenAges babies }
    }
  }
  availability { status reasons { code label } }
`;

const DAILY_OFFERS_QUERY = `
  query IbisPelotasDailyOffers(
    $hotelId: ID!
    $hotelOffersHotelId: String!
    $dateIn: Date!
    $dateOut: Date!
    $nbAdults: PositiveInt!
    $childrenAges: [NonNegativeInt!]
    $countryMarket: String!
    $currency: String!
    $selectionStep: Int
    $totalRoomInBasket: PositiveInt
  ) {
    hotel(hotelId: $hotelId) {
      accommodations { code name }
    }
    memberOffers: hotelOffers(
      hotelId: $hotelOffersHotelId
      dateIn: $dateIn
      dateOut: $dateOut
      nbAdults: $nbAdults
      childrenAges: $childrenAges
      countryMarket: $countryMarket
      currency: $currency
      hideMemberRate: false
    ) { ${HOTEL_OFFERS_FIELDS} }
    publicOffers: hotelOffers(
      hotelId: $hotelOffersHotelId
      dateIn: $dateIn
      dateOut: $dateOut
      nbAdults: $nbAdults
      childrenAges: $childrenAges
      countryMarket: $countryMarket
      currency: $currency
      hideMemberRate: true
    ) { ${HOTEL_OFFERS_FIELDS} }
  }
`;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`Resposta inválida da Accor em ${label}.`);
  }
  return value;
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function getStayDates(checkIn: string, nights: number): string[] {
  return Array.from({ length: nights }, (_, index) => addDays(checkIn, index));
}

function differenceInDays(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00.000Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function parseIbisBrazilianPrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const direct = Number(trimmed);
    return Number.isFinite(direct) && direct >= 0 ? direct : null;
  }

  const currencyMatch = /R\$\s*([\d.\s\u00a0]+(?:,\d{1,2})?)/i.exec(trimmed);
  const candidate = currencyMatch?.[1] ?? trimmed;
  const normalized = candidate
    .replace(/\s|\u00a0/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return normalized && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function buildIbisPelotasSearchUrl(
  params: Pick<ValidatedPricingSearch, "checkIn" | "checkOut" | "adults">,
  bookingUrl = ACCOR_BOOKING_URL,
): string {
  const url = new URL(bookingUrl);
  url.searchParams.set("dateIn", params.checkIn);
  url.searchParams.set(
    "nights",
    String(differenceInDays(params.checkIn, params.checkOut)),
  );
  url.searchParams.set("compositions", String(params.adults));
  url.searchParams.set("stayplus", "false");
  return url.toString();
}

function extractPublicGraphqlKey(html: string): string {
  const key = /\bgqlApiKey\s*:\s*["']([^"']+)["']/.exec(html)?.[1];
  if (!key) {
    throw new Error("Configuração pública do GraphQL da Accor não encontrada.");
  }
  return key;
}

function mandatoryTax(formattedTaxType: unknown): number | null {
  if (typeof formattedTaxType !== "string") return null;
  const normalized = normalizeText(formattedTaxType);
  const excluded = /nao incluidos?|not included|excluded/.test(normalized);
  const included = /incluidos?|included/.test(normalized) && !excluded;

  if (included) return 0;
  if (!excluded) return null;
  return parseIbisBrazilianPrice(formattedTaxType);
}

function breakfastIncluded(mealPlan: unknown): boolean | null {
  const record = isRecord(mealPlan) ? mealPlan : {};
  const value = normalizeText(`${record.code ?? ""} ${record.label ?? ""}`);
  if (/bed_and_breakfast|cafe da manha|breakfast/.test(value)) return true;
  if (/room_only|sem cafe|sem refeicao/.test(value)) return false;
  return null;
}

function refundable(cancellation: unknown): boolean | null {
  const record = isRecord(cancellation) ? cancellation : {};
  const value = normalizeText(`${record.code ?? ""} ${record.label ?? ""}`);
  if (/free_cancellation|cancelamento sem custo|cancelamento gratis/.test(value)) {
    return true;
  }
  if (/non_refundable|nao reembolsavel|sem reembolso/.test(value)) return false;
  return null;
}

function emptySourceResult(
  status: "unavailable" | "error" | "manual_verification_required",
  searchUrl: string,
): SourceResult {
  return {
    source: "official_site",
    status,
    bestPrice: null,
    bestProvider: null,
    searchUrl,
    offers: [],
    ...(status === "manual_verification_required"
      ? {
          manualVerification: {
            mode: "human_in_the_loop" as const,
            reason: "captcha_required" as const,
          },
        }
      : {}),
  };
}

function emptyDays(
  params: ValidatedPricingSearch,
  status: "error" | "manual_verification_required",
): OfficialSiteDailyResult[] {
  return getStayDates(params.checkIn, params.nights).map((date) => {
    const searchUrl = buildIbisPelotasSearchUrl({
      checkIn: date,
      checkOut: addDays(date, 1),
      adults: params.adults,
    });
    return { date, result: emptySourceResult(status, searchUrl) };
  });
}

function accommodationNames(data: UnknownRecord): Map<string, string> {
  const hotel = requireRecord(data.hotel, "data.hotel");
  if (!Array.isArray(hotel.accommodations)) {
    throw new Error("Resposta inválida da Accor em hotel.accommodations.");
  }

  return new Map(
    hotel.accommodations.flatMap((raw): Array<[string, string]> => {
      const accommodation = isRecord(raw) ? raw : {};
      const code = String(accommodation.code ?? "").trim();
      const name = String(accommodation.name ?? "").trim();
      return code && name ? [[code, name]] : [];
    }),
  );
}

function parseOfferGroup(
  groupValue: unknown,
  category: "member" | "public",
  date: string,
  adults: number,
  roomNames: ReadonlyMap<string, string>,
): { availabilityStatus: string; offers: HotelOffer[] } {
  const group = requireRecord(groupValue, `${category}Offers`);
  const availability = requireRecord(
    group.availability,
    `${category}Offers.availability`,
  );
  const availabilityStatus = String(availability.status ?? "").trim();
  if (!["AVAILABLE", "NOT_AVAILABLE"].includes(availabilityStatus)) {
    throw new Error("Status de disponibilidade desconhecido na resposta da Accor.");
  }

  const selection = requireRecord(
    group.offersSelection,
    `${category}Offers.offersSelection`,
  );
  if (!Array.isArray(selection.offers)) {
    throw new Error("Resposta inválida da Accor em offersSelection.offers.");
  }

  const offers: HotelOffer[] = [];
  for (const rawOffer of selection.offers) {
    const offer = requireRecord(rawOffer, "offersSelection.offers[]");
    const pricing = requireRecord(offer.pricing, "offer.pricing");
    const main = requireRecord(pricing.main, "offer.pricing.main");
    const lengthOfStay = requireRecord(offer.lengthOfStay, "offer.lengthOfStay");
    const product = requireRecord(offer.product, "offer.product");
    const rate = requireRecord(offer.rate, "offer.rate");
    const occupancy = requireRecord(offer.occupancy, "offer.occupancy");

    if (pricing.currency !== "BRL") {
      throw new Error("A Accor não retornou a tarifa na moeda BRL.");
    }
    if (
      pricing.aggregationType !== "TOTAL_STAY" ||
      lengthOfStay.value !== 1 ||
      lengthOfStay.unit !== "NIGHT"
    ) {
      throw new Error("A Accor não retornou uma tarifa total de exatamente uma diária.");
    }
    if (Number(occupancy.adults) !== adults) continue;
    if (Array.isArray(occupancy.childrenAges) && occupancy.childrenAges.length > 0) {
      continue;
    }

    const categories = Array.isArray(main.categories)
      ? main.categories.map(String)
      : [];
    const expectedCategory = category === "member" ? "MEMBER_RATE" : "STANDARD";
    if (!categories.includes(expectedCategory)) continue;

    const basePrice = parseIbisBrazilianPrice(main.amount);
    const tax = mandatoryTax(pricing.formattedTaxType);
    if (basePrice === null || basePrice <= 0 || tax === null) {
      throw new Error("Preço final obrigatório não pôde ser determinado na Accor.");
    }

    const productId = String(product.id ?? "").trim();
    const rateId = String(rate.id ?? "").trim();
    if (!productId || !rateId) {
      throw new Error("Identificação de quarto ou tarifa ausente na Accor.");
    }

    offers.push({
      id: `ibis-pelotas-${date}-${adults}-${productId}-${rateId}-${category}`,
      source: "official_site",
      providerName: "Site oficial",
      roomName: roomNames.get(productId) ?? null,
      breakfastIncluded: breakfastIncluded(offer.mealPlan),
      refundable: refundable(
        isRecord(main.simplifiedPolicies)
          ? main.simplifiedPolicies.cancellation
          : null,
      ),
      offerUrl: null,
      price: Math.round((basePrice + tax) * 100) / 100,
      currency: "BRL",
    });
  }

  return { availabilityStatus, offers };
}

export function parseIbisPelotasDailyAvailability(
  date: string,
  adults: number,
  searchUrl: string,
  payload: unknown,
): SourceResult {
  const response = requireRecord(payload, "resposta GraphQL");
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw new Error("A API GraphQL da Accor retornou erro.");
  }
  const data = requireRecord(response.data, "data");
  const roomNames = accommodationNames(data);
  const member = parseOfferGroup(
    data.memberOffers,
    "member",
    date,
    adults,
    roomNames,
  );
  const publicRates = parseOfferGroup(
    data.publicOffers,
    "public",
    date,
    adults,
    roomNames,
  );
  const statuses = [member.availabilityStatus, publicRates.availabilityStatus];
  const offers = [...member.offers, ...publicRates.offers];
  const uniqueOffers = Array.from(
    new Map(offers.map((offer) => [offer.id, offer])).values(),
  ).sort((left, right) => left.price - right.price);

  if (uniqueOffers.length === 0) {
    if (statuses.every((status) => status !== "AVAILABLE")) {
      return emptySourceResult("unavailable", searchUrl);
    }
    throw new Error("A Accor indicou disponibilidade, mas não retornou tarifas válidas.");
  }

  return {
    source: "official_site",
    status: "success",
    bestPrice: uniqueOffers[0].price,
    bestProvider: "Site oficial",
    searchUrl,
    offers: uniqueOffers,
  };
}

function isHumanVerificationChallenge(body: string): boolean {
  return /captcha|incapsula incident|request unsuccessful|access denied|cf-chl/i.test(
    body,
  );
}

function developmentLog(event: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info(event, details ?? {});
  }
}

export class IbisPelotasOfficialProvider
  implements OfficialSitePricingProvider
{
  readonly hotelSlug = IBIS_PELOTAS_SLUG;
  private readonly options: IbisPelotasProviderOptions;

  constructor(options: IbisPelotasProviderOptions = {}) {
    this.options = options;
  }

  async search(
    params: ValidatedPricingSearch,
    hotel: PricingHotel,
  ): Promise<OfficialSiteDailyResult[]> {
    void hotel;
    const initialSearchUrl = buildIbisPelotasSearchUrl(
      params,
      this.options.bookingUrl,
    );
    const fetcher = this.options.fetcher ?? fetch;
    const graphqlUrl = this.options.graphqlUrl ?? ACCOR_GRAPHQL_URL;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 20_000,
    );

    developmentLog("IBIS_PELOTAS_SEARCH_START", {
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      adults: params.adults,
    });

    try {
      const pageResponse = await fetcher(initialSearchUrl, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "HotelPriceMonitor/1.0",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      const pageHtml = await pageResponse.text();

      if (!pageResponse.ok) {
        if (
          [401, 403, 429].includes(pageResponse.status) &&
          isHumanVerificationChallenge(pageHtml)
        ) {
          throw new ManualVerificationRequiredError();
        }
        throw new Error(`HTTP ${pageResponse.status} ao abrir o motor Accor.`);
      }

      const publicGraphqlKey = extractPublicGraphqlKey(pageHtml);
      const days = getStayDates(params.checkIn, params.nights);
      const results: OfficialSiteDailyResult[] = [];
      // Each batch settles completely: a failed night cannot discard successful nights.
      for (let offset = 0; offset < days.length; offset += 3) {
        const batch = await Promise.all(
          days.slice(offset, offset + 3).map(async (date): Promise<OfficialSiteDailyResult> => {
            const nextDate = addDays(date, 1);
            const searchUrl = buildIbisPelotasSearchUrl(
              { checkIn: date, checkOut: nextDate, adults: params.adults },
              this.options.bookingUrl,
            );
            try {
              controller.signal.throwIfAborted();
              const response = await fetcher(graphqlUrl, {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  apiKey: publicGraphqlKey,
                  "app-id": ACCOR_APP_ID,
                  lang: "pt-br",
                  "User-Agent": "HotelPriceMonitor/1.0",
                },
                body: JSON.stringify({
                  operationName: "IbisPelotasDailyOffers",
                  query: DAILY_OFFERS_QUERY,
                  variables: {
                    hotelId: ACCOR_HOTEL_ID,
                    hotelOffersHotelId: ACCOR_HOTEL_ID,
                    dateIn: date,
                    dateOut: nextDate,
                    nbAdults: params.adults,
                    childrenAges: [],
                    countryMarket: "BR",
                    currency: "BRL",
                    selectionStep: 0,
                    totalRoomInBasket: 1,
                  },
                }),
                cache: "no-store",
                signal: controller.signal,
              });
              const body = await response.text();

              if (!response.ok) {
                if (
                  [401, 403, 429].includes(response.status) &&
                  isHumanVerificationChallenge(body)
                ) {
                  throw new ManualVerificationRequiredError();
                }
                throw new Error(`HTTP ${response.status} ao consultar a API Accor.`);
              }

              let payload: unknown;
              try {
                payload = JSON.parse(body);
              } catch {
                throw new Error("A API Accor retornou JSON inválido.");
              }

              return {
                date,
                result: parseIbisPelotasDailyAvailability(date, params.adults, searchUrl, payload),
              };
            } catch (error) {
              const status = error instanceof ManualVerificationRequiredError
                ? "manual_verification_required"
                : "error";
              developmentLog("IBIS_PELOTAS_ERROR", {
                checkIn: date,
                checkOut: nextDate,
                adults: params.adults,
                reason: status === "manual_verification_required"
                  ? "human_verification"
                  : controller.signal.aborted ? "timeout" : "daily_collection_error",
              });
              return { date, result: emptySourceResult(status, searchUrl) };
            }
          }),
        );
        results.push(...batch);
      }
      const offerCounts = results.map((day) => day.result.offers.length);

      if (results.every((day) => day.result.status === "unavailable")) {
        developmentLog("IBIS_PELOTAS_UNAVAILABLE", {
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          adults: params.adults,
        });
      } else if (offerCounts.some((count) => count > 0)) {
        developmentLog("IBIS_PELOTAS_SEARCH_SUCCESS", {
          days: results.length,
          offers: offerCounts.reduce((total, count) => total + count, 0),
          bestPrices: results.map((day) => day.result.bestPrice),
        });
      }

      return results;
    } catch (error) {
      if (error instanceof ManualVerificationRequiredError) {
        developmentLog("IBIS_PELOTAS_ERROR", { reason: "human_verification" });
        return emptyDays(params, "manual_verification_required");
      }

      developmentLog("IBIS_PELOTAS_ERROR", {
        reason: controller.signal.aborted ? "timeout" : "collection_error",
      });
      return emptyDays(params, "error");
    } finally {
      controller.abort();
      clearTimeout(timeout);
    }
  }
}
