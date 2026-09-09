import "server-only";

import { hbookFetch } from "./hbook-transport.ts";

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

const CURI_PALACE_SLUG = "curi-palace-hotel";
const HBOOK_COMPANY_ID = "61607dad584d1d88bb3eb28f";
const HBOOK_BOOKING_URL = "https://hbook.hsystem.com.br/booking";
const HBOOK_AVAILABILITY_URL =
  "https://hbook.hsystem.com.br/Booking/GetAvailability";

type UnknownRecord = Record<string, unknown>;

interface CuriPalaceProviderOptions {
  bookingUrl?: string;
  availabilityUrl?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}

interface RateMetadata {
  breakfastIncluded: boolean | null;
  refundable: boolean | null;
}

class CaptchaRequiredError extends Error {
  constructor() {
    super("O HBook passou a exigir verificação manual para esta consulta.");
    this.name = "CaptchaRequiredError";
  }
}


function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`Resposta inválida do HBook em ${label}.`);
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

function toBrazilianDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function fromBrazilianDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function parseCuriPalaceBrazilianPrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const direct = Number(trimmed);
    return Number.isFinite(direct) && direct > 0 ? direct : null;
  }

  const normalized = trimmed
    .replace(/R\$/gi, "")
    .replace(/\s|\u00a0/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return normalized && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildCuriPalaceSearchUrl(
  params: Pick<ValidatedPricingSearch, "checkIn" | "checkOut" | "adults">,
  bookingUrl = HBOOK_BOOKING_URL,
): string {
  const url = new URL(bookingUrl);
  url.searchParams.set("companyId", HBOOK_COMPANY_ID);
  url.searchParams.set("checkin", toBrazilianDate(params.checkIn));
  url.searchParams.set("checkout", toBrazilianDate(params.checkOut));
  url.searchParams.set("adults", String(params.adults));
  url.searchParams.set("children", "0");
  return url.toString();
}

function extractAvailabilityToken(html: string): string {
  const inputTags = html.match(/<input\b[^>]*>/gi) ?? [];
  const tokenTag = inputTags.find((tag) =>
    /\bid=["']availabilityToken["']/i.test(tag),
  );
  const value = tokenTag?.match(/\bvalue=["']([^"']+)["']/i)?.[1];

  if (!value) {
    throw new Error("Token público de disponibilidade não encontrado no HBook.");
  }

  return value.replace(/&amp;/g, "&");
}

function extractJsonArrayAssignment(
  source: string,
  variableName: string,
): unknown[] | null {
  const safeName = variableName.replace(/[^a-zA-Z0-9_$]/g, "");
  const assignment = new RegExp(`\\bvar\\s+${safeName}\\s*=\\s*`).exec(source);

  if (!assignment || assignment.index === undefined) return null;
  const start = source.indexOf("[", assignment.index + assignment[0].length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        const parsed: unknown = JSON.parse(source.slice(start, index + 1));
        return Array.isArray(parsed) ? parsed : null;
      }
    }
  }

  return null;
}

function breakfastFromRate(rate: UnknownRecord): boolean | null {
  const labels: string[] = [];

  if (typeof rate.MealPlanView === "string") labels.push(rate.MealPlanView);
  if (Array.isArray(rate.ExtraProducts)) {
    for (const product of rate.ExtraProducts) {
      const record = isRecord(product) ? product : {};
      if (typeof record.Name === "string") labels.push(record.Name);
    }
  }

  const description = normalizeText(labels.join(" "));
  if (/sem cafe|sem refeicao|room only|without breakfast|breakfast not included/.test(description)) return false;
  if (/cafe da manha|breakfast/.test(description)) return true;
  return null;
}

function refundableFromRate(rate: UnknownRecord): boolean | null {
  const paymentPolicy = isRecord(rate.PaymentPolicy) ? rate.PaymentPolicy : {};
  return typeof paymentPolicy.IsNonRefundable === "boolean"
    ? !paymentPolicy.IsNonRefundable
    : null;
}

function extractRateMetadata(html: string): Map<string, RateMetadata> {
  try {
    const rateTypes = extractJsonArrayAssignment(html, "rateTypes") ?? [];
    return new Map(
      rateTypes.flatMap((value): Array<[string, RateMetadata]> => {
        const rate = isRecord(value) ? value : {};
        const id = String(rate.Id ?? "").trim();
        return id
          ? [[id, {
              breakfastIncluded: breakfastFromRate(rate),
              refundable: refundableFromRate(rate),
            }]]
          : [];
      }),
    );
  } catch {
    return new Map();
  }
}

function hbookRateDate(value: unknown): string | null {
  const record = isRecord(value) ? value : {};
  if (typeof record.Date === "string") {
    const isoDate = /^(\d{4}-\d{2}-\d{2})/.exec(record.Date)?.[1];
    if (isoDate) return isoDate;
  }

  return typeof record.FullFormatedDate === "string"
    ? fromBrazilianDate(record.FullFormatedDate)
    : null;
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
  searchUrl: string,
  status: "unavailable" | "error" | "manual_verification_required",
): OfficialSiteDailyResult[] {
  return getStayDates(params.checkIn, params.nights).map((date) => ({
    date,
    result: emptySourceResult(status, searchUrl),
  }));
}

export function parseCuriPalaceAvailability(
  params: ValidatedPricingSearch,
  searchUrl: string,
  payload: unknown,
  rateMetadata: ReadonlyMap<string, RateMetadata> = new Map(),
): OfficialSiteDailyResult[] {
  const response = requireRecord(payload, "disponibilidade");
  if (response.HasErrors === true) {
    throw new Error("O HBook recusou os parâmetros da pesquisa.");
  }
  if (!Array.isArray(response.Rooms)) {
    throw new Error("Resposta inválida do HBook em disponibilidade.Rooms.");
  }
  if (response.Rooms.length === 0) {
    return emptyDays(params, searchUrl, "unavailable");
  }

  const offersByDate = new Map<string, HotelOffer[]>(
    getStayDates(params.checkIn, params.nights).map((date) => [date, []]),
  );
  let availableRoomCount = 0;
  let rateCount = 0;

  for (const rawRoom of response.Rooms) {
    const room = requireRecord(rawRoom, "disponibilidade.Rooms[]");
    const availability = Number(room.Availability);
    if (room.Availability == null || !Number.isFinite(availability) || availability < 0) {
      throw new Error("Disponibilidade inválida na resposta do HBook.");
    }
    if (availability === 0) continue;
    availableRoomCount += 1;
    if (!Array.isArray(room.Rates)) {
      throw new Error("Resposta inválida do HBook em disponibilidade.Rates.");
    }

    for (const rawRate of room.Rates) {
      const rate = requireRecord(rawRate, "disponibilidade.Rates[]");
      rateCount += 1;
      const roomId = String(room.RoomTypeId ?? "room");
      const rateId = String(rate.RateTypeId ?? "rate");
      const metadata = rateMetadata.get(rateId);
      const roomName =
        typeof room.RoomTypeName === "string" && room.RoomTypeName.trim()
          ? room.RoomTypeName.trim()
          : null;
      const perDayRates = Array.isArray(rate.PerDayRates)
        ? rate.PerDayRates
        : [];
      const dailyPrices = new Map<string, number>();

      for (const rawDay of perDayRates) {
        const date = hbookRateDate(rawDay);
        const day = isRecord(rawDay) ? rawDay : {};
        const price = parseCuriPalaceBrazilianPrice(day.Rate);
        if (date && price !== null) dailyPrices.set(date, price);
      }

      if (params.nights === 1 && !dailyPrices.has(params.checkIn)) {
        const fallbackPrice = parseCuriPalaceBrazilianPrice(
          rate.DailyPrice ?? rate.TotalValue,
        );
        if (fallbackPrice !== null) dailyPrices.set(params.checkIn, fallbackPrice);
      }

      for (const [date, price] of dailyPrices) {
        const offers = offersByDate.get(date);
        if (!offers) continue;
        offers.push({
          id: `curi-palace-${roomId}-${rateId}-${date}-${params.adults}`,
          source: "official_site",
          providerName: "Site oficial",
          roomName,
          breakfastIncluded: metadata?.breakfastIncluded ?? null,
          refundable: metadata?.refundable ?? null,
          offerUrl: null,
          price,
          currency: "BRL",
        });
      }
    }
  }

  if (availableRoomCount === 0 || rateCount === 0) {
    return emptyDays(params, searchUrl, "unavailable");
  }

  return Array.from(offersByDate, ([date, offers]) => {
    if (offers.length === 0) {
      throw new Error(`O HBook não retornou preço diário para ${date}.`);
    }
    offers.sort((left, right) => left.price - right.price);
    return {
      date,
      result: {
        source: "official_site" as const,
        status: "success" as const,
        bestPrice: offers[0].price,
        bestProvider: "Site oficial",
        searchUrl,
        offers,
      },
    };
  });
}

function isCaptchaChallenge(body: string): boolean {
  return /não sou um robô|nao sou um robo|captcha challenge|cf-chl-captcha/i.test(
    body,
  );
}

function developmentLog(event: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info(event, details ?? {});
  }
}

export class CuriPalaceOfficialProvider
  implements OfficialSitePricingProvider
{
  readonly hotelSlug = CURI_PALACE_SLUG;
  private readonly options: CuriPalaceProviderOptions;

  constructor(options: CuriPalaceProviderOptions = {}) {
    this.options = options;
  }

  async search(
    params: ValidatedPricingSearch,
    hotel: PricingHotel,
  ): Promise<OfficialSiteDailyResult[]> {
    void hotel;
    const searchUrl = buildCuriPalaceSearchUrl(params, this.options.bookingUrl);
    const fetcher = this.options.fetcher ?? hbookFetch;
    const availabilityUrl =
      this.options.availabilityUrl ?? HBOOK_AVAILABILITY_URL;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 15_000,
    );

    developmentLog("CURI_PALACE_SEARCH_START", {
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      adults: params.adults,
    });

    try {
      const pageResponse = await fetcher(searchUrl, {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml" },
        cache: "no-store",
        signal: controller.signal,
      });
      const pageHtml = await pageResponse.text();

      if (!pageResponse.ok) {
        if (
          [401, 403, 429].includes(pageResponse.status) &&
          isCaptchaChallenge(pageHtml)
        ) {
          throw new CaptchaRequiredError();
        }
        throw new Error(`HTTP ${pageResponse.status} ao abrir o HBook.`);
      }

      const availabilityToken = extractAvailabilityToken(pageHtml);
      const rateMetadata = extractRateMetadata(pageHtml);
      const availabilityResponse = await fetcher(availabilityUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          CompanyId: HBOOK_COMPANY_ID,
          ArrivalDateString: toBrazilianDate(params.checkIn),
          DepartureDateString: toBrazilianDate(params.checkOut),
          PromotionalCode: "",
          AmountAdults: params.adults,
          AmountChildren: 0,
          ChildrenAges: [],
          IsReturningAbandonedBooking: false,
          IsReturningBudgetBooking: false,
          Language: "pt-BR",
          AvailabilityToken: availabilityToken,
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      const availabilityBody = await availabilityResponse.text();

      if (!availabilityResponse.ok) {
        if (
          [401, 403, 429].includes(availabilityResponse.status) &&
          isCaptchaChallenge(availabilityBody)
        ) {
          throw new CaptchaRequiredError();
        }
        throw new Error(
          `HTTP ${availabilityResponse.status} ao consultar o HBook.`,
        );
      }

      let availabilityPayload: unknown;
      try {
        availabilityPayload = JSON.parse(availabilityBody);
      } catch {
        throw new Error("O HBook retornou JSON inválido.");
      }

      const results = parseCuriPalaceAvailability(
        params,
        searchUrl,
        availabilityPayload,
        rateMetadata,
      );
      const offerCounts = results.map((day) => day.result.offers.length);

      if (offerCounts.every((count) => count === 0)) {
        developmentLog("CURI_PALACE_UNAVAILABLE", {
          checkIn: params.checkIn,
          checkOut: params.checkOut,
          adults: params.adults,
        });
      } else {
        developmentLog("CURI_PALACE_SEARCH_SUCCESS", {
          days: results.length,
          offers: offerCounts.reduce((total, count) => total + count, 0),
          bestPrices: results.map((day) => day.result.bestPrice),
        });
      }

      return results;
    } catch (error) {
      if (error instanceof CaptchaRequiredError) {
        developmentLog("CURI_PALACE_ERROR", { reason: "captcha_required" });
        return emptyDays(params, searchUrl, "manual_verification_required");
      }

      developmentLog("CURI_PALACE_ERROR", {
        reason: controller.signal.aborted ? "timeout" : "collection_error",
      });
      return emptyDays(params, searchUrl, "error");
    } finally {
      controller.abort();
      clearTimeout(timeout);
    }
  }
}
