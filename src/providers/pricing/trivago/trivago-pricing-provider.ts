import "server-only";

import type { Page } from "playwright";
import { launchTrivagoBrowser, TrivagoBrowserError } from "./browser.ts";

import type {
  TrivagoDailyResult,
  TrivagoPricingSourceProvider,
} from "@/providers/pricing/types";
import type {
  HotelOffer,
  PricingHotel,
  SourceResult,
  ValidatedPricingSearch,
} from "@/types/pricing";

const TRIVAGO_BASE_URL = "https://www.trivago.com.br";
const DEFAULT_ATTEMPT_TIMEOUT_MS = 40_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
const DEFAULT_GRAPHQL_TIMEOUT_MS = 18_000;
const DEFAULT_PARSING_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const DEFAULT_TRIVAGO_MAX_CONCURRENCY = 3;
const HARD_TRIVAGO_MAX_CONCURRENCY = 3;

export interface ConcurrencySnapshot {
  active: number;
  queued: number;
  limit: number;
  peak: number;
}

export function resolveTrivagoMaxConcurrency(
  value = process.env.TRIVAGO_MAX_CONCURRENCY,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_TRIVAGO_MAX_CONCURRENCY;
  }
  return Math.min(parsed, HARD_TRIVAGO_MAX_CONCURRENCY);
}

export class TrivagoConcurrencyLimiter {
  readonly limit: number;
  private active = 0;
  private peak = 0;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("O limite de concorrencia do Trivago deve ser positivo.");
    }
    this.limit = limit;
  }

  snapshot(): ConcurrencySnapshot {
    return {
      active: this.active,
      queued: this.queue.length,
      limit: this.limit,
      peak: this.peak,
    };
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        this.peak = Math.max(this.peak, this.active);
        resolve();
      });
    });
  }

  private release() {
    this.active -= 1;
    this.queue.shift()?.();
  }
}

export const trivagoBrowserLimiter = new TrivagoConcurrencyLimiter(
  resolveTrivagoMaxConcurrency(),
);

type TrivagoErrorCategory =
  | "graphql_http_error"
  | "graphql_timeout"
  | "graphql_property_not_found"
  | "graphql_empty_offers"
  | "navigation_http_error"
  | "navigation_timeout"
  | "network_error"
  | "dom_card_not_found"
  | "dom_expand_timeout"
  | "dom_parse_error"
  | "browser_not_installed"
  | "browser_launch_error"
  | "collector_contract_error"
  | "unexpected_error";

export interface TrivagoCollectionRequest {
  date: string;
  checkoutDate: string;
  adults: number;
  propertyId: string;
  searchUrl: string;
}

export interface TrivagoCollectedOffer {
  providerName: string | null;
  priceText: string;
  roomName: string | null;
  rateName?: string | null;
  detailsText?: string | null;
  breakfastIncluded?: boolean | null;
  refundable?: boolean | null;
  attributes: string[];
}

export type TrivagoCollectionOutcome =
  | {
      kind: "success";
      offers: TrivagoCollectedOffer[];
      diagnostics?: {
        graphqlHttpStatus: number | null;
        propertyFound: boolean;
        graphqlOffersCount: number;
        domUsed: boolean;
        expansionUsed: boolean;
      };
    }
  | { kind: "unavailable" }
  | { kind: "manual_verification_required" }
  | {
      kind: "error";
      message: string;
      category?: TrivagoErrorCategory;
      httpStatus?: number;
      retryable?: boolean;
    };

interface TrivagoDiagnostics {
  hotelSlug: string;
  propertyId: string;
  adults: number;
  searchId: string;
  attempt: number;
  navigationTimeoutMs: number;
  graphqlTimeoutMs: number;
  parsingTimeoutMs: number;
}

export type TrivagoCollector = (
  requests: TrivagoCollectionRequest[],
  timeoutMs: number,
  diagnostics?: TrivagoDiagnostics,
) => Promise<TrivagoCollectionOutcome[]>;

export interface TrivagoPricingProviderOptions {
  propertyId: string;
  hotelName: string;
  hotelSlug: string;
  searchPathSlug?: string;
  baseUrl?: string;
  timeoutMs?: number;
  navigationTimeoutMs?: number;
  graphqlTimeoutMs?: number;
  parsingTimeoutMs?: number;
  retryDelaysMs?: readonly number[];
  collector?: TrivagoCollector;
}

interface InFlightSearch {
  searchId: string;
  promise: Promise<TrivagoDailyResult[]>;
}

const inFlightSearches = new Map<string, InFlightSearch>();
let searchSequence = 0;

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function nextSearchId(): string {
  searchSequence += 1;
  return `trivago-${Date.now().toString(36)}-${searchSequence.toString(36)}`;
}

function elapsedSince(startedAt: number): number {
  return Date.now() - startedAt;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitForSignal(
  signal: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      signal.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function defaultRetryDelayMs(nextAttempt: number): number {
  return nextAttempt === 2
    ? 850 + Math.floor(Math.random() * 351)
    : 2_200 + Math.floor(Math.random() * 701);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function containsPropertyNsid(value: unknown, propertyId: string): boolean {
  if (!isRecord(value)) return false;
  if (String(value.ns ?? "") === "100" && String(value.id ?? "") === propertyId) {
    return true;
  }
  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some((item) => containsPropertyNsid(item, propertyId))
      : containsPropertyNsid(child, propertyId),
  );
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

const TRIVAGO_ADVERTISER_NAMES: Readonly<Record<string, string>> = {
  "15": "HRS.com",
  "395": "Agoda",
  "406": "Expedia",
  "626": "Booking.com",
  "634": "Trip.com",
  "1852": "Decolar",
  "3340": "Hoteis.com",
  "3620": "Ourtrip",
  "3708": "Quero Passagem",
};

export interface TrivagoGraphqlOffers {
  propertyFound: boolean;
  complete: boolean;
  offers: TrivagoCollectedOffer[];
  unmappedAdvertisers: Array<{ advertiserId: string; price: number }>;
}

function readAmount(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const amount =
    typeof value.amount === "number"
      ? value.amount
      : typeof value.amount === "string"
        ? Number(value.amount)
        : Number.NaN;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function readAdvertiserName(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["name", "displayName", "translatedName", "label"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const nsid = isRecord(value.nsid) ? value.nsid : null;
  return nsid ? TRIVAGO_ADVERTISER_NAMES[String(nsid.id ?? "")] ?? null : null;
}

function readDescriptiveText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) return null;
  for (const key of ["name", "label", "text", "description", "value"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function readFirstText(
  records: Array<Record<string, unknown> | null>,
  keys: readonly string[],
): string | null {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const text = readDescriptiveText(record[key]);
      if (text) return text;
    }
  }
  return null;
}

function readFirstBoolean(
  records: Array<Record<string, unknown> | null>,
  keys: readonly string[],
): boolean | null {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      if (typeof record[key] === "boolean") return record[key];
    }
  }
  return null;
}

function breakfastFromText(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (/sem cafe|without breakfast|room only/.test(normalized)) return false;
  return /cafe da manha|breakfast/.test(normalized) ? true : null;
}

function refundableFromText(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (/nao reembolsavel|non-refundable|non refundable/.test(normalized)) {
    return false;
  }
  return /reembolsavel|refundable|cancelamento gratuito|free cancellation/.test(
    normalized,
  )
    ? true
    : null;
}

function formatCancellationDeadline(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Cancelamento gratuito";
  return `Cancelamento gratuito até ${new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)}`;
}

function readGraphqlDealDetails(deal: Record<string, unknown>) {
  const priceDetails = isRecord(deal.priceDetails) ? deal.priceDetails : null;
  const records = [deal, priceDetails];
  const roomName = readFirstText(records, [
    "roomName",
    "roomType",
    "roomCategory",
  ]);
  const rateName = readFirstText(records, ["rateName", "ratePlanName"]);
  const boardText = readFirstText(records, ["mealPlan", "boardType"]);
  const descriptiveKeys = [
    "detailsText",
    "secondaryText",
    "policyText",
    "benefitLabel",
  ] as const;
  const details = records.flatMap((record) =>
    record
      ? descriptiveKeys.flatMap((key) => {
          const text = readDescriptiveText(record[key]);
          return text ? [text] : [];
        })
      : [],
  );
  for (const key of ["attributes", "badges", "benefits", "benefitLabels"]) {
    const values = deal[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const text = readDescriptiveText(value);
      if (text) details.push(text);
    }
  }
  const cancellationText = formatCancellationDeadline(
    priceDetails?.freeCancellationDeadline,
  );
  if (cancellationText) details.push(cancellationText);
  const detailsText = Array.from(new Set(details)).join(" · ") || null;
  const breakfastIncluded =
    readFirstBoolean(records, ["breakfastIncluded", "hasBreakfast"]) ??
    breakfastFromText(boardText ?? detailsText);
  const refundable =
    readFirstBoolean(records, [
      "refundable",
      "isRefundable",
      "hasFreeCancellation",
    ]) ??
    (cancellationText ? true : refundableFromText(detailsText));

  return {
    roomName,
    rateName,
    detailsText,
    breakfastIncluded,
    refundable,
  };
}

export function parseTrivagoGraphqlOffers(
  body: unknown,
  propertyId: string,
): TrivagoGraphqlOffers {
  const data = isRecord(body) ? body.data : null;
  const searchResponse = isRecord(data)
    ? data.accommodationSearchResponse
    : null;
  const accommodations = isRecord(searchResponse)
    ? searchResponse.accommodations
    : null;
  if (!Array.isArray(accommodations)) {
    return {
      propertyFound: false,
      complete: false,
      offers: [],
      unmappedAdvertisers: [],
    };
  }

  const property = accommodations.find(
    (candidate) =>
      isRecord(candidate) && containsPropertyNsid(candidate.nsid, propertyId),
  );
  if (!isRecord(property)) {
    return {
      propertyFound: false,
      complete: false,
      offers: [],
      unmappedAdvertisers: [],
    };
  }

  const deals = property.deals;
  if (!isRecord(deals)) {
    return {
      propertyFound: true,
      complete: false,
      offers: [],
      unmappedAdvertisers: [],
    };
  }
  const alternatives = Array.isArray(deals.alternatives)
    ? deals.alternatives
    : [];
  const candidates = [deals.best, ...alternatives, deals.cheapest].filter(
    isRecord,
  );
  const hasCompleteShape =
    Object.hasOwn(deals, "best") &&
    Array.isArray(deals.alternatives) &&
    Object.hasOwn(deals, "cheapest");
  const seen = new Set<string>();
  const offers: TrivagoCollectedOffer[] = [];
  const unmappedAdvertisers: Array<{
    advertiserId: string;
    price: number;
  }> = [];
  let invalidCandidate = false;

  for (const deal of candidates) {
    if (!containsPropertyNsid(deal.accommodationDetails, propertyId)) {
      invalidCandidate = true;
      continue;
    }
    const price =
      readAmount(deal.allInPricePerNight) ?? readAmount(deal.pricePerNight);
    const providerName = readAdvertiserName(deal.advertiserDetails);
    const advertiserNsid = isRecord(deal.advertiserDetails)
      ? deal.advertiserDetails.nsid
      : null;
    const advertiserId = isRecord(advertiserNsid)
      ? String(advertiserNsid.id ?? "")
      : "";
    if (price === null || providerName === null) {
      if (price !== null && advertiserId) {
        unmappedAdvertisers.push({ advertiserId, price });
      }
      invalidCandidate = true;
      continue;
    }
    const key = `${String(deal.id ?? "")}|${advertiserId || providerName}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const details = readGraphqlDealDetails(deal);
    offers.push({
      providerName,
      priceText: `R$ ${price}`,
      roomName: details.roomName,
      rateName: details.rateName,
      detailsText: details.detailsText,
      breakfastIncluded: details.breakfastIncluded,
      refundable: details.refundable,
      attributes: [],
    });
  }

  return {
    propertyFound: true,
    complete: hasCompleteShape && !invalidCandidate,
    offers,
    unmappedAdvertisers,
  };
}

function classifyError(
  error: unknown,
  fallback: TrivagoErrorCategory = "unexpected_error",
): Extract<TrivagoCollectionOutcome, { kind: "error" }> {
  if (error instanceof TrivagoBrowserError) {
    return { kind: "error", message: error.message, category: error.category, retryable: false };
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Erro desconhecido no Trivago.";
  const normalized = normalizeText(message);
  const statusMatch = message.match(/HTTP\s+(\d{3})/i);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : undefined;

  if (/executable doesn't exist|browser.*(?:not installed|executable.*not found)|playwright install/.test(normalized)) {
    return {
      kind: "error",
      message: "Chromium não instalado. Execute npx playwright install chromium no ambiente de coleta.",
      category: "browser_not_installed",
      retryable: false,
    };
  }

  if (httpStatus === 408 || /stream timeout|\b408\b/.test(normalized)) {
    return {
      kind: "error",
      message,
      category: "graphql_http_error",
      httpStatus: 408,
      retryable: true,
    };
  }
  if (/graphql.*timeout|consulta estruturada.*timeout/.test(normalized)) {
    return {
      kind: "error",
      message,
      category: "graphql_timeout",
      retryable: true,
    };
  }
  if (/navigation|abrir o trivago/.test(normalized) && /timeout/.test(normalized)) {
    return {
      kind: "error",
      message,
      category: "navigation_timeout",
      retryable: true,
    };
  }
  if (/timeout/.test(normalized)) {
    return {
      kind: "error",
      message,
      category:
        fallback === "dom_parse_error" ? "dom_expand_timeout" : fallback,
      retryable: true,
    };
  }
  if (/fetch failed|network|econn|socket|abort/.test(normalized)) {
    return {
      kind: "error",
      message,
      category: "network_error",
      retryable: true,
    };
  }
  if (httpStatus !== undefined) {
    return {
      kind: "error",
      message,
      category:
        fallback === "navigation_http_error"
          ? "navigation_http_error"
          : "graphql_http_error",
      httpStatus,
      retryable: httpStatus === 429 || httpStatus >= 500,
    };
  }
  return {
    kind: "error",
    message,
    category: fallback,
    retryable:
      fallback === "dom_parse_error" ||
      fallback === "dom_card_not_found" ||
      fallback === "graphql_property_not_found" ||
      fallback === "graphql_empty_offers",
  };
}

function developmentLog(event: string, details: Record<string, unknown>) {
  const productionEvents = new Set([
    "TRIVAGO_SEARCH_START",
    "TRIVAGO_RETRY",
    "TRIVAGO_SEARCH_SUCCESS",
    "TRIVAGO_SEARCH_ERROR",
  ]);
  if (process.env.NODE_ENV !== "development" && !productionEvents.has(event)) return;
  const allowedFields = new Set([
    "searchId", "hotelSlug", "propertyId", "checkIn", "checkOut", "adults",
    "attempt", "durationMs", "httpStatus", "propertyFound", "offersCount",
    "graphqlOffersCount", "domUsed", "expansionUsed", "errorCategory",
  ]);
  const safeDetails = {
    source: "trivago",
    ...Object.fromEntries(Object.entries(details).filter(([key]) => allowedFields.has(key))),
  };
  if (process.env.NODE_ENV === "development") console.info(event, safeDetails);
  else console.info(JSON.stringify({ event, ...safeDetails }));
}

function diagnosticDetails(
  diagnostics: TrivagoDiagnostics,
  request: TrivagoCollectionRequest,
  startedAt: number,
  extra: Record<string, unknown> = {},
) {
  return {
    searchId: diagnostics.searchId,
    hotelSlug: diagnostics.hotelSlug,
    propertyId: diagnostics.propertyId,
    checkIn: request.date,
    checkOut: request.checkoutDate,
    adults: diagnostics.adults,
    attempt: diagnostics.attempt,
    durationMs: elapsedSince(startedAt),
    ...extra,
  };
}

export function parseTrivagoBrazilianPrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  const currencyMatches = Array.from(
    value.matchAll(/R\$\s*([\d.\s\u00a0]+(?:,\d{1,2})?)/gi),
  );
  const priceValue = currencyMatches.at(-1)?.[1] ?? value;
  const compact = priceValue
    .replace(/R\$/gi, "")
    .replace(/[\s\u00a0]/g, "")
    .replace(/[^0-9.,-]/g, "");

  if (!compact) return null;

  let normalized: string;
  if (compact.includes(",")) {
    normalized = compact.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, "");
  } else {
    normalized = compact;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildTrivagoSearchUrl(
  input: Pick<ValidatedPricingSearch, "checkIn" | "checkOut" | "adults">,
  config: Pick<
    TrivagoPricingProviderOptions,
    "propertyId" | "hotelSlug" | "searchPathSlug" | "baseUrl"
  >,
): string {
  const baseUrl = (config.baseUrl ?? TRIVAGO_BASE_URL).replace(/\/$/, "");
  const pathSlug = config.searchPathSlug ?? config.hotelSlug;
  const search = [
    `100-${config.propertyId}`,
    `dr-${compactDate(input.checkIn)}-${compactDate(input.checkOut)}`,
    "drs-40",
    `rc-1-${input.adults}`,
  ].join(";");

  return `${baseUrl}/pt-BR/lm/${encodeURIComponent(pathSlug)}?search=${search}`;
}

function isAntiBotChallenge(bodyText: string): boolean {
  return /captcha|recaptcha|nao sou um robo|verify you are human|unusual traffic|access denied|checking your browser|security check/.test(
    normalizeText(bodyText),
  );
}

function isExplicitUnavailability(bodyText: string): boolean {
  return /indisponivel|nao ha ofertas|sem ofertas|nenhuma oferta|nenhum preco|nao disponivel/.test(
    normalizeText(bodyText),
  );
}

async function pageBodyText(page: Page): Promise<string> {
  return page.locator("body").innerText().catch(() => "");
}

interface TrivagoTransportState {
  error: Extract<TrivagoCollectionOutcome, { kind: "error" }> | null;
  manualVerificationRequired: boolean;
  graphqlHttpStatus: number | null;
  propertyFound: boolean;
  structuredComplete: boolean;
  structuredOffers: TrivagoCollectedOffer[];
  unmappedAdvertisers: Array<{ advertiserId: string; price: number }>;
  ready: Promise<void>;
}

async function installTrivagoJsonTransport(
  page: Page,
  requestConfig: TrivagoCollectionRequest,
  diagnostics: TrivagoDiagnostics,
  startedAt: number,
): Promise<TrivagoTransportState> {
  const pageController = new AbortController();
  page.once("close", () => pageController.abort());
  let signalReady: () => void = () => undefined;
  const state: TrivagoTransportState = {
    error: null,
    manualVerificationRequired: false,
    graphqlHttpStatus: null,
    propertyFound: false,
    structuredComplete: false,
    structuredOffers: [],
    unmappedAdvertisers: [],
    ready: new Promise<void>((resolve) => {
      signalReady = resolve;
    }),
  };

  await page.route(
    /\/graphql\?(?:accommodationSearchQuery|accommodationSearchDeals)/,
    async (route) => {
      const request = route.request();
      const isAccommodationSearchQuery = request.url().includes(
        "accommodationSearchQuery",
      );
      const requestBody = parseJson(request.postData());
      if (!containsPropertyNsid(requestBody, requestConfig.propertyId)) {
        await route.continue();
        return;
      }

      developmentLog(
        "TRIVAGO_GRAPHQL_DETECTED",
        diagnosticDetails(diagnostics, requestConfig, startedAt),
      );
      const originalHeaders = await request.allHeaders();
      const headers = Object.fromEntries(
        Object.entries(originalHeaders).filter(
          ([key]) =>
            !/^:/.test(key) &&
            !/^(?:cookie|authorization|proxy-authorization|host|content-length|accept-encoding)$/i.test(
              key,
            ) &&
            !/^sec-/i.test(key),
        ),
      );
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          diagnostics.graphqlTimeoutMs,
        );
        let response: Response;
        let body: Buffer;
        try {
          response = await fetch(request.url(), {
            method: request.method(),
            headers,
            body: request.postData() ?? undefined,
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, pageController.signal]),
          });
          body = Buffer.from(await response.arrayBuffer());
        } finally {
          clearTimeout(timeout);
        }
        const parsedBody = parseJson(body.toString("utf8"));
        state.graphqlHttpStatus = response.status;

        if (response.status === 403) {
          state.manualVerificationRequired = true;
          signalReady();
        } else if (!response.ok) {
          state.error = classifyError(
            new Error(
              `HTTP ${response.status} na consulta estruturada do Trivago.`,
            ),
          );
          signalReady();
        }
        if (response.ok && isAccommodationSearchQuery) {
          const structured = parseTrivagoGraphqlOffers(
            parsedBody,
            requestConfig.propertyId,
          );
          state.propertyFound ||= structured.propertyFound;
          if (structured.propertyFound) {
            state.error = null;
            if (structured.offers.length > 0) {
              state.structuredOffers = structured.offers;
            }
          }
          state.unmappedAdvertisers = structured.unmappedAdvertisers;
          if (structured.complete) {
            state.structuredComplete = true;
            state.structuredOffers = structured.offers;
            signalReady();
          }
        }

        developmentLog(
          "TRIVAGO_GRAPHQL_STATUS",
          diagnosticDetails(diagnostics, requestConfig, startedAt, {
            httpStatus: response.status,
            propertyFound: state.propertyFound,
            offersCount: state.structuredOffers.length,
            unmappedAdvertisers: state.unmappedAdvertisers,
            errorCategory:
              state.error?.category ??
              (response.ok &&
              isAccommodationSearchQuery &&
              !state.propertyFound
                ? "graphql_property_not_found"
                : state.structuredComplete &&
                    state.structuredOffers.length === 0
                  ? "graphql_empty_offers"
                  : null),
          }),
        );

        await route.fulfill({
          status: response.status,
          headers: {
            "content-type":
              response.headers.get("content-type") ?? "application/json",
          },
          body,
        });
      } catch (error) {
        if (pageController.signal.aborted) return;
        const aborted = error instanceof Error && error.name === "AbortError";
        state.error = classifyError(
          aborted ? new Error("GraphQL timeout no Trivago.") : error,
          aborted ? "graphql_timeout" : "network_error",
        );
        signalReady();
        developmentLog(
          "TRIVAGO_GRAPHQL_STATUS",
          diagnosticDetails(diagnostics, requestConfig, startedAt, {
            httpStatus: null,
            propertyFound: state.propertyFound,
            offersCount: state.structuredOffers.length,
            errorCategory: state.error.category,
          }),
        );
        await route.continue().catch(() => route.abort().catch(() => undefined));
      }
    },
  );

  return state;
}

async function extractExpandedOffers(
  page: Page,
): Promise<TrivagoCollectedOffer[]> {
  const slideout = page.locator('[data-testid="deals-slideout"]').first();
  await slideout.waitFor({ state: "visible" });
  await slideout
    .locator('[data-testid="deal-list-item"]')
    .first()
    .waitFor({ state: "attached" });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const expanders = slideout.getByRole("button", {
      name: /Mostrar mais \d+ preços/i,
    });
    if ((await expanders.count()) === 0) break;
    const expander = expanders.first();
    if (!(await expander.isVisible().catch(() => false))) break;
    const beforeCount = await slideout
      .locator('[data-testid="deal-summary"]')
      .count();
    await expander.scrollIntoViewIfNeeded();
    await expander.click({ force: true });
    await Promise.race([
      slideout
        .locator('[data-testid="deal-summary"]')
        .nth(beforeCount)
        .waitFor({ state: "attached", timeout: 2_500 }),
      expander.waitFor({ state: "detached", timeout: 2_500 }),
    ]).catch(() => undefined);
    const afterCount = await slideout
      .locator('[data-testid="deal-summary"]')
      .count();
    if (afterCount <= beforeCount) break;
  }

  return slideout
    .locator('[data-testid="deal-list-item"]')
    .evaluateAll((groups) =>
      groups.flatMap((group) => {
        const groupProvider =
          group
            .querySelector<HTMLElement>('[data-testid="advertiser-name"]')
            ?.innerText.trim() || null;
        const summaries = Array.from(
          group.querySelectorAll<HTMLElement>('[data-testid="deal-summary"]'),
        );

        return summaries.flatMap((summary) => {
          const priceText =
            summary
              .querySelector<HTMLElement>('[data-testid="slideout-deal-price"]')
              ?.innerText.trim() ?? "";
          if (!priceText) return [];

          const providerName =
            summary
              .querySelector<HTMLElement>('[data-testid="advertiser-name"]')
              ?.innerText.trim() || groupProvider;
          const roomName =
            Array.from(summary.querySelectorAll<HTMLElement>("p"))
              .find(
                (element) =>
                  element.dataset.testid !== "all-in-price-disclaimer",
              )
              ?.innerText.trim() || null;
          const attributes = Array.from(
            summary.querySelectorAll<HTMLElement>(
              '[data-testid="rate-attribute"]',
            ),
            (element) => element.innerText.trim(),
          ).filter(Boolean);

          return [{ providerName, priceText, roomName, attributes }];
        });
      }),
    );
}

async function extractSingleOffer(
  card: ReturnType<Page["locator"]>,
): Promise<TrivagoCollectedOffer[]> {
  const wrapper = card.locator('[data-testid="recommended-deal-wrapper"]').first();
  const priceText =
    (await wrapper
      .locator('[data-testid="recommended-price"]')
      .first()
      .innerText()
      .catch(() => "")) || "";
  if (!priceText.trim()) return [];

  const providerName =
    (await wrapper
      .locator('[data-testid="advertiser-name"]')
      .first()
      .innerText()
      .catch(() => "")) || null;
  const attributes = await wrapper
    .locator('[data-testid="rate-attribute"]')
    .allInnerTexts();

  return [
    {
      providerName: providerName?.trim() || null,
      priceText: priceText.trim(),
      roomName: null,
      attributes: attributes.map((value) => value.trim()).filter(Boolean),
    },
  ];
}

function collectedOfferKey(offer: TrivagoCollectedOffer): string | null {
  const providerName = offer.providerName?.trim();
  const price = parseTrivagoBrazilianPrice(offer.priceText);
  return providerName && price !== null
    ? `${normalizeText(providerName)}|${price}`
    : null;
}

function collectedDetailsSignature(offer: TrivagoCollectedOffer): string {
  return JSON.stringify({
    roomName: offer.roomName ?? null,
    rateName: offer.rateName ?? null,
    detailsText: offer.detailsText ?? null,
    breakfastIncluded: offer.breakfastIncluded ?? null,
    refundable: offer.refundable ?? null,
    attributes: offer.attributes,
  });
}

export function mergeTrivagoOfferDetails(
  structuredOffers: TrivagoCollectedOffer[],
  domOffers: TrivagoCollectedOffer[],
): { offers: TrivagoCollectedOffer[]; enriched: boolean } {
  const structuredCounts = new Map<string, number>();
  const domByKey = new Map<string, TrivagoCollectedOffer[]>();
  for (const offer of structuredOffers) {
    const key = collectedOfferKey(offer);
    if (key) structuredCounts.set(key, (structuredCounts.get(key) ?? 0) + 1);
  }
  for (const offer of domOffers) {
    const key = collectedOfferKey(offer);
    if (!key) continue;
    domByKey.set(key, [...(domByKey.get(key) ?? []), offer]);
  }

  let enriched = false;
  const offers = structuredOffers.map((offer) => {
    const key = collectedOfferKey(offer);
    const matches = key ? domByKey.get(key) ?? [] : [];
    if (!key || structuredCounts.get(key) !== 1 || matches.length !== 1) {
      return offer;
    }
    const dom = matches[0];
    const merged: TrivagoCollectedOffer = {
      ...offer,
      roomName: offer.roomName ?? dom.roomName ?? null,
      rateName: offer.rateName ?? dom.rateName ?? null,
      detailsText: offer.detailsText ?? dom.detailsText ?? null,
      breakfastIncluded:
        offer.breakfastIncluded ?? dom.breakfastIncluded ?? null,
      refundable: offer.refundable ?? dom.refundable ?? null,
      attributes: Array.from(
        new Set([...offer.attributes, ...dom.attributes]),
      ),
    };
    if (collectedDetailsSignature(merged) !== collectedDetailsSignature(offer)) {
      enriched = true;
    }
    return merged;
  });

  return { offers, enriched };
}

async function collectTrivagoPage(
  page: Page,
  request: TrivagoCollectionRequest,
  diagnostics: TrivagoDiagnostics,
): Promise<TrivagoCollectionOutcome> {
  const startedAt = Date.now();
  page.setDefaultTimeout(diagnostics.parsingTimeoutMs);
  const transport = await installTrivagoJsonTransport(
    page,
    request,
    diagnostics,
    startedAt,
  );
  let response;
  try {
    response = await page.goto(request.searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: diagnostics.navigationTimeoutMs,
    });
  } catch (error) {
    throw classifyError(error, "navigation_timeout");
  }
  developmentLog(
    "TRIVAGO_PAGE_LOADED",
    diagnosticDetails(diagnostics, request, startedAt, {
      httpStatus: response?.status() ?? null,
    }),
  );
  const bodyText = await pageBodyText(page);

  if (
    transport.manualVerificationRequired ||
    isAntiBotChallenge(bodyText) ||
    response?.status() === 403
  ) {
    return { kind: "manual_verification_required" };
  }
  if (response && !response.ok()) {
    throw classifyError(
      new Error(`HTTP ${response.status()} ao abrir o Trivago.`),
      "navigation_http_error",
    );
  }

  await waitForSignal(transport.ready, diagnostics.graphqlTimeoutMs);
  if (transport.manualVerificationRequired) {
    return { kind: "manual_verification_required" };
  }
  if (transport.error && transport.structuredOffers.length === 0) {
    throw transport.error;
  }

  const graphqlDiagnostics = {
    graphqlHttpStatus: transport.graphqlHttpStatus,
    propertyFound: transport.propertyFound,
    graphqlOffersCount: transport.structuredOffers.length,
  };
  const success = (
    offers: TrivagoCollectedOffer[],
    domUsed: boolean,
    expansionUsed: boolean,
    errorCategory: string | null,
  ): TrivagoCollectionOutcome => {
    developmentLog(
      "TRIVAGO_OFFERS_PARSED",
      diagnosticDetails(diagnostics, request, startedAt, {
        httpStatus: transport.graphqlHttpStatus,
        propertyFound: transport.propertyFound,
        offersCount: offers.length,
        graphqlOffersCount: transport.structuredOffers.length,
        domUsed,
        expansionUsed,
        errorCategory,
      }),
    );
    return {
      kind: "success",
      offers,
      diagnostics: {
        ...graphqlDiagnostics,
        domUsed,
        expansionUsed,
      },
    };
  };

  if (
    transport.structuredComplete &&
    transport.structuredOffers.length > 0
  ) {
    return success(transport.structuredOffers, false, false, null);
  }

  const graphqlFallbackOffers = transport.structuredOffers;

  const propertyLink = page
    .locator(
      `a[data-testid="item-name-link"][href*="search=100-${request.propertyId}"]`,
    )
    .first();
  const emptySearch = page
    .getByText(/Sem resultados|Nenhuma acomodação encontrada/i)
    .first();

  try {
    await Promise.race([
      propertyLink.waitFor({
        state: "attached",
        timeout: diagnostics.parsingTimeoutMs,
      }),
      emptySearch.waitFor({
        state: "visible",
        timeout: diagnostics.parsingTimeoutMs,
      }),
    ]);
    if ((await propertyLink.count()) === 0) {
      throw new Error("A pesquisa terminou sem a propriedade esperada.");
    }
  } catch {
    const currentBodyText = await pageBodyText(page);
    if (
      transport.manualVerificationRequired ||
      isAntiBotChallenge(currentBodyText)
    ) {
      return { kind: "manual_verification_required" };
    }
    if (transport.error) throw transport.error;
    if (isExplicitUnavailability(currentBodyText)) {
      return { kind: "unavailable" };
    }
    if (graphqlFallbackOffers.length > 0) {
      return success(
        graphqlFallbackOffers,
        true,
        false,
        "dom_card_not_found",
      );
    }
    if (!transport.propertyFound) {
      throw classifyError(
        new Error(
          `A resposta GraphQL não trouxe a propriedade ${request.propertyId}.`,
        ),
        "graphql_property_not_found",
      );
    }
    throw classifyError(
      new Error(
        `A propriedade ${request.propertyId} não foi localizada no resultado do Trivago.`,
      ),
      "dom_card_not_found",
    );
  }

  const propertyHref = await propertyLink.getAttribute("href");
  const renderedProperty = propertyHref
    ? new URL(propertyHref, request.searchUrl).searchParams.get("search")?.split(";")[0]
    : null;
  if (renderedProperty !== `100-${request.propertyId}`) {
    throw classifyError(
      new Error("O resultado renderizado não corresponde à propriedade esperada."),
      "dom_card_not_found",
    );
  }

  const card = page.locator("article").filter({ has: propertyLink }).first();
  const recommendedDeal = card
    .locator('[data-testid="recommended-deal-wrapper"]')
    .first();
  await recommendedDeal
    .waitFor({
      state: "attached",
      timeout: Math.min(diagnostics.parsingTimeoutMs, 8_000),
    })
    .catch(() => undefined);

  if ((await recommendedDeal.count()) === 0) {
    const cardText = await card.innerText().catch(() => "");
    if (isAntiBotChallenge(cardText)) {
      return { kind: "manual_verification_required" };
    }
    if (isExplicitUnavailability(cardText)) {
      return { kind: "unavailable" };
    }
    if (transport.error) throw transport.error;
    if (graphqlFallbackOffers.length > 0) {
      return success(
        graphqlFallbackOffers,
        true,
        false,
        "dom_card_not_found",
      );
    }
    throw classifyError(
      new Error("O card correto foi carregado sem uma resposta de ofertas."),
      "dom_card_not_found",
    );
  }

  let cardOffers: TrivagoCollectedOffer[] = [];
  try {
    cardOffers = await extractSingleOffer(card);
  } catch (error) {
    if (graphqlFallbackOffers.length > 0) {
      return success(graphqlFallbackOffers, true, false, "dom_parse_error");
    }
    throw classifyError(error, "dom_parse_error");
  }

  const allPricesButton = card
    .locator('[data-testid="additional-prices-slideout-entry-point"]')
    .first();
  if (
    (await allPricesButton.count()) > 0 &&
    (await allPricesButton.isVisible().catch(() => false))
  ) {
    try {
      await page.keyboard.press("Escape");
      await allPricesButton.scrollIntoViewIfNeeded();
      await allPricesButton.click({ force: true });
      const expandedOffers = await extractExpandedOffers(page);
      if (expandedOffers.length > 0) {
        return success(expandedOffers, true, true, null);
      }
    } catch (error) {
      const usableOffers =
        graphqlFallbackOffers.length > 0
          ? graphqlFallbackOffers
          : cardOffers;
      if (usableOffers.length > 0) {
        return success(usableOffers, true, true, "dom_expand_timeout");
      }
      throw classifyError(error, "dom_parse_error");
    }
  }

  const fallbackOffers =
    graphqlFallbackOffers.length > 0 ? graphqlFallbackOffers : cardOffers;
  if (fallbackOffers.length > 0) {
    return success(fallbackOffers, true, false, "dom_parse_error");
  }
  throw classifyError(
    new Error("A GraphQL e o DOM não retornaram ofertas válidas."),
    transport.propertyFound
      ? "graphql_empty_offers"
      : "dom_parse_error",
  );
}

async function collectWithPlaywright(
  requests: TrivagoCollectionRequest[],
  timeoutMs: number,
  diagnostics?: TrivagoDiagnostics,
): Promise<TrivagoCollectionOutcome[]> {
  if (!diagnostics) {
    throw new Error("Diagnóstico obrigatório para a coleta real do Trivago.");
  }
  return trivagoBrowserLimiter.run(async () => {
    const browser = await launchTrivagoBrowser();

    try {
      const context = await browser.newContext();
      const results: TrivagoCollectionOutcome[] = [];

      try {
        for (const request of requests) {
          const page = await context.newPage();
          let outcome: TrivagoCollectionOutcome;
          try {
            let timeout: ReturnType<typeof setTimeout> | undefined;
            try {
              outcome = await Promise.race([
                collectTrivagoPage(page, request, diagnostics),
                new Promise<TrivagoCollectionOutcome>((_, reject) => {
                  timeout = setTimeout(
                    () =>
                      reject(
                        classifyError(
                          new Error("Timeout total na consulta do Trivago."),
                          "dom_parse_error",
                        ),
                      ),
                    timeoutMs,
                  );
                }),
              ]);
            } finally {
              if (timeout) clearTimeout(timeout);
            }
          } catch (error) {
            const bodyText = await pageBodyText(page);
            outcome = isAntiBotChallenge(bodyText)
              ? { kind: "manual_verification_required" }
              : isRecord(error) && error.kind === "error"
                ? (error as Extract<TrivagoCollectionOutcome, { kind: "error" }>)
                : classifyError(error, "dom_parse_error");
          } finally {
            await page.close().catch(() => undefined);
          }

          results.push(outcome);
        }

        return results;
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
}

function emptyResult(
  status: "unavailable" | "error" | "manual_verification_required",
  searchUrl: string,
): SourceResult {
  return {
    source: "trivago",
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

function offerMetadata(raw: TrivagoCollectedOffer) {
  const text = normalizeText(
    [raw.roomName, raw.rateName, raw.detailsText, ...raw.attributes]
      .filter(Boolean)
      .join(" "),
  );
  const breakfastIncluded = /cafe da manha incluido|breakfast included/.test(
    text,
  )
    ? true
    : /sem cafe|cafe nao incluido|breakfast not included/.test(text)
      ? false
      : null;
  const refundable = /cancelamento gratuito|free cancellation/.test(text)
    ? true
    : /nao reembolsavel|non-refundable|non refundable/.test(text)
      ? false
      : null;
  const rateAttributes = raw.attributes.filter(
    (attribute) =>
      !/cafe da manha incluido|breakfast included/.test(
        normalizeText(attribute),
      ),
  );

  return {
    breakfastIncluded: raw.breakfastIncluded ?? breakfastIncluded,
    refundable: raw.refundable ?? refundable,
    rateName:
      raw.rateName?.trim() ||
      (rateAttributes.length > 0 ? rateAttributes.join(" · ") : null),
  };
}

function normalizeSuccess(
  hotelSlug: string,
  request: TrivagoCollectionRequest,
  rawOffers: TrivagoCollectedOffer[],
): SourceResult {
  const offers: HotelOffer[] = rawOffers.map((raw, index) => {
    const price = parseTrivagoBrazilianPrice(raw.priceText);
    if (price === null || !raw.providerName?.trim()) {
      throw new Error(`Preço inválido na oferta ${index + 1} do Trivago.`);
    }
    const metadata = offerMetadata(raw);

    return {
      id: `${hotelSlug}-${request.date}-trivago-${request.adults}-${index + 1}`,
      source: "trivago",
      providerName: raw.providerName?.trim() || null,
      roomName: raw.roomName?.trim() || null,
      rateName: metadata.rateName,
      detailsText: raw.detailsText?.trim() || null,
      breakfastIncluded: metadata.breakfastIncluded,
      refundable: metadata.refundable,
      offerUrl: request.searchUrl,
      price,
      currency: "BRL",
    };
  });

  offers.sort(
    (left, right) =>
      left.price - right.price ||
      (left.providerName ?? "").localeCompare(right.providerName ?? ""),
  );

  if (offers.length === 0) {
    throw new Error("O coletor indicou sucesso sem ofertas válidas.");
  }

  return {
    source: "trivago",
    status: "success",
    bestPrice: offers[0].price,
    bestProvider: offers[0].providerName,
    searchUrl: request.searchUrl,
    offers,
  };
}

export class TrivagoPricingProvider
  implements TrivagoPricingSourceProvider
{
  readonly hotelSlug: string;
  private readonly options: TrivagoPricingProviderOptions;

  constructor(options: TrivagoPricingProviderOptions) {
    if (!/^\d+$/.test(options.propertyId)) {
      throw new Error("O propertyId do Trivago deve ser numérico.");
    }
    this.options = options;
    this.hotelSlug = options.hotelSlug;
  }

  async search(
    params: ValidatedPricingSearch,
    hotel: PricingHotel,
  ): Promise<TrivagoDailyResult[]> {
    const requests: TrivagoCollectionRequest[] = Array.from(
      { length: params.nights },
      (_, index) => {
        const date = addDays(params.checkIn, index);
        const checkoutDate = addDays(date, 1);
        return {
          date,
          checkoutDate,
          adults: params.adults,
          propertyId: this.options.propertyId,
          searchUrl: buildTrivagoSearchUrl(
            { checkIn: date, checkOut: checkoutDate, adults: params.adults },
            this.options,
          ),
        };
      },
    );
    const inFlightKey = [
      this.options.propertyId,
      params.checkIn,
      params.checkOut,
      params.adults,
    ].join("|");
    const existing = inFlightSearches.get(inFlightKey);

    if (existing) {
      developmentLog("TRIVAGO_SEARCH_START", {
        searchId: existing.searchId,
        hotelSlug: hotel.slug,
        propertyId: this.options.propertyId,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        adults: params.adults,
        attempt: 0,
        durationMs: 0,
        errorCategory: "inflight_deduplicated",
      });
    }

    if (
      hotel.slug !== this.hotelSlug ||
      String(hotel.trivago_property_id ?? "") !== this.options.propertyId
    ) {
      developmentLog("TRIVAGO_SEARCH_ERROR", {
        searchId: "configuration-error",
        hotelSlug: hotel.slug,
        propertyId: this.options.propertyId,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        adults: params.adults,
        attempt: 0,
        durationMs: 0,
        errorCategory: "configuration_mismatch",
      });
      return requests.map((request) => ({
        date: request.date,
        result: emptyResult("error", request.searchUrl),
      }));
    }

    if (existing) return existing.promise;

    const searchId = nextSearchId();
    developmentLog("TRIVAGO_SEARCH_START", {
      searchId,
      hotelSlug: hotel.slug,
      propertyId: this.options.propertyId,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      adults: params.adults,
      attempt: 0,
      durationMs: 0,
      errorCategory: null,
    });

    const promise = this.performSearch(params, hotel, requests, searchId);
    const entry: InFlightSearch = { searchId, promise };
    inFlightSearches.set(inFlightKey, entry);

    try {
      return await promise;
    } finally {
      if (inFlightSearches.get(inFlightKey) === entry) {
        inFlightSearches.delete(inFlightKey);
      }
    }
  }

  private async performSearch(
    params: ValidatedPricingSearch,
    hotel: PricingHotel,
    requests: TrivagoCollectionRequest[],
    searchId: string,
  ): Promise<TrivagoDailyResult[]> {
    const startedAt = Date.now();
    const collector = this.options.collector ?? collectWithPlaywright;
    const attemptTimeoutMs =
      this.options.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    const navigationTimeoutMs =
      this.options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    const graphqlTimeoutMs =
      this.options.graphqlTimeoutMs ?? DEFAULT_GRAPHQL_TIMEOUT_MS;
    const parsingTimeoutMs =
      this.options.parsingTimeoutMs ?? DEFAULT_PARSING_TIMEOUT_MS;
    const outcomes: TrivagoCollectionOutcome[] = requests.map(() => ({
      kind: "error",
      message: "A consulta do Trivago não foi concluída.",
      category: "unexpected_error",
      retryable: true,
    }));
    const attemptsByRequest = requests.map(() => 0);
    let pendingIndexes = requests.map((_, index) => index);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (pendingIndexes.length === 0) break;
      if (attempt > 1) {
        const configuredDelay = this.options.retryDelaysMs?.[attempt - 2];
        await sleep(configuredDelay ?? defaultRetryDelayMs(attempt));
      }

      const pendingRequests = pendingIndexes.map((index) => requests[index]);
      for (const request of pendingRequests) {
        developmentLog("TRIVAGO_ATTEMPT", {
          searchId,
          hotelSlug: hotel.slug,
          propertyId: this.options.propertyId,
          checkIn: request.date,
          checkOut: request.checkoutDate,
          adults: params.adults,
          attempt,
          durationMs: elapsedSince(startedAt),
        });
      }

      let collected: TrivagoCollectionOutcome[];
      try {
        collected = await collector(pendingRequests, attemptTimeoutMs, {
          hotelSlug: hotel.slug,
          propertyId: this.options.propertyId,
          adults: params.adults,
          searchId,
          attempt,
          navigationTimeoutMs,
          graphqlTimeoutMs,
          parsingTimeoutMs,
        });
      } catch (error) {
        const classified = classifyError(error);
        collected = pendingRequests.map(() => classified);
      }

      if (collected.length !== pendingRequests.length) {
        collected = pendingRequests.map(() => ({
          kind: "error",
          message: "O coletor retornou uma quantidade inesperada de resultados.",
          category: "collector_contract_error",
          retryable: false,
        }));
      }

      const nextPending: number[] = [];
      pendingIndexes.forEach((requestIndex, collectedIndex) => {
        let outcome = collected[collectedIndex];
        attemptsByRequest[requestIndex] = attempt;
        if (outcome.kind === "error" && outcome.category === undefined) {
          const classified = classifyError(outcome.message);
          outcome = {
            ...classified,
            ...outcome,
            category: classified.category,
            httpStatus: outcome.httpStatus ?? classified.httpStatus,
            retryable: outcome.retryable ?? classified.retryable,
          };
        }
        outcomes[requestIndex] = outcome;

        if (
          outcome.kind === "error" &&
          outcome.retryable === true &&
          attempt < MAX_ATTEMPTS
        ) {
          nextPending.push(requestIndex);
          const request = requests[requestIndex];
          developmentLog("TRIVAGO_RETRY", {
            searchId,
            hotelSlug: hotel.slug,
            propertyId: this.options.propertyId,
            checkIn: request.date,
            checkOut: request.checkoutDate,
            adults: params.adults,
            attempt,
            httpStatus: outcome.httpStatus ?? null,
            durationMs: elapsedSince(startedAt),
            errorCategory: outcome.category ?? "unexpected_error",
          });
        }
      });
      pendingIndexes = nextPending;
    }

    return requests.map((request, index): TrivagoDailyResult => {
      const outcome = outcomes[index];
      let result: SourceResult;
      let errorCategory =
        outcome.kind === "error" ? outcome.category : undefined;

      try {
        result =
          outcome.kind === "success"
            ? normalizeSuccess(this.hotelSlug, request, outcome.offers)
            : emptyResult(outcome.kind, request.searchUrl);
      } catch {
        result = emptyResult("error", request.searchUrl);
        errorCategory = "dom_parse_error";
      }

      const outcomeDiagnostics =
        outcome.kind === "success" ? outcome.diagnostics : undefined;
      const details = {
        searchId,
        hotelSlug: hotel.slug,
        propertyId: this.options.propertyId,
        checkIn: request.date,
        checkOut: request.checkoutDate,
        adults: params.adults,
        attempt: attemptsByRequest[index],
        httpStatus:
          outcome.kind === "error"
            ? outcome.httpStatus ?? null
            : outcomeDiagnostics?.graphqlHttpStatus ?? null,
        propertyFound: outcomeDiagnostics?.propertyFound ?? false,
        graphqlOffersCount: outcomeDiagnostics?.graphqlOffersCount ?? 0,
        domUsed: outcomeDiagnostics?.domUsed ?? false,
        expansionUsed: outcomeDiagnostics?.expansionUsed ?? false,
        offersCount: result.offers.length,
        durationMs: elapsedSince(startedAt),
      };
      if (result.status === "success") {
        developmentLog("TRIVAGO_SEARCH_SUCCESS", details);
      } else if (
        result.status === "error" ||
        result.status === "manual_verification_required"
      ) {
        developmentLog("TRIVAGO_SEARCH_ERROR", {
          ...details,
          errorCategory:
            result.status === "manual_verification_required"
              ? "manual_verification_required"
              : errorCategory ?? "unexpected_error",
        });
      }

      return { date: request.date, result };
    });
  }
}

export function createTrivagoProviderMap(
  configs: readonly TrivagoPricingProviderOptions[],
): Map<string, TrivagoPricingSourceProvider> {
  return new Map(
    configs.map((config) => {
      const provider = new TrivagoPricingProvider(config);
      return [provider.hotelSlug, provider] as const;
    }),
  );
}
