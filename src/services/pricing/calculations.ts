import type {
  DailyHotelRate,
  DailyPricingResult,
  DailyStrategyPoint,
  PricingSearchResult,
  PricingSummary,
  PriceComparison,
  ProviderDailyResult,
  SourceResult,
  ValidatedPricingSearch,
} from "@/types/pricing";

function validPrice(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function getCompetitivePrice(
  officialSite: SourceResult,
  trivago: SourceResult,
): number | null {
  const prices = [officialSite, trivago]
    .filter((result) => result.status === "success")
    .map((result) => result.bestPrice)
    .filter(validPrice);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function enrichDay(day: ProviderDailyResult): DailyPricingResult {
  const withCompetitivePrice = day.hotels.map<DailyHotelRate>((hotel) => ({
    ...hotel,
    competitivePrice: getCompetitivePrice(hotel.officialSite, hotel.trivago),
    comparisonBySource: { official_site: null, trivago: null },
  }));
  const reference = withCompetitivePrice.find((hotel) => hotel.isReferenceHotel);

  return {
    date: day.date,
    checkoutDate: day.checkoutDate,
    hotels: withCompetitivePrice.map((hotel) => {
      if (hotel.isReferenceHotel || !reference) {
        return hotel;
      }

      return {
        ...hotel,
        comparisonBySource: {
          official_site: compareSource(hotel.officialSite, reference.officialSite),
          trivago: compareSource(hotel.trivago, reference.trivago),
        },
      };
    }),
  };
}

function compareSource(
  competitor: SourceResult,
  reference: SourceResult,
): PriceComparison | null {
  if (
    competitor.status !== "success" ||
    reference.status !== "success" ||
    !validPrice(competitor.bestPrice) ||
    !validPrice(reference.bestPrice)
  ) return null;

  const differenceValue = competitor.bestPrice - reference.bestPrice;
  return {
    differenceValue,
    differencePercent: (differenceValue / reference.bestPrice) * 100,
  };
}

export function buildDailyStrategy(day: DailyPricingResult): DailyStrategyPoint {
  const reference = day.hotels.find((hotel) => hotel.isReferenceHotel);
  const competitors = day.hotels
    .filter(
      (hotel) => !hotel.isReferenceHotel && validPrice(hotel.competitivePrice),
    )
    .sort(
      (left, right) =>
        (left.competitivePrice as number) - (right.competitivePrice as number),
    );
  const cheapestCompetitor = competitors[0];

  if (
    !reference ||
    !validPrice(reference.competitivePrice) ||
    !cheapestCompetitor ||
    !validPrice(cheapestCompetitor.competitivePrice)
  ) {
    return {
      date: day.date,
      status: "unavailable",
      referencePrice: reference?.competitivePrice ?? null,
      cheapestCompetitorName: null,
      cheapestCompetitorPrice: null,
      differenceValue: null,
      differencePercent: null,
    };
  }

  const differenceValue =
    reference.competitivePrice - cheapestCompetitor.competitivePrice;

  return {
    date: day.date,
    status: "success",
    referencePrice: reference.competitivePrice,
    cheapestCompetitorName: cheapestCompetitor.hotelName,
    cheapestCompetitorPrice: cheapestCompetitor.competitivePrice,
    differenceValue,
    differencePercent:
      (differenceValue / cheapestCompetitor.competitivePrice) * 100,
  };
}

export function buildPricingSummary(
  strategy: DailyStrategyPoint[],
): PricingSummary {
  const analyzed = strategy.filter(
    (point) => point.status === "success" && point.differenceValue !== null,
  );
  const largest = analyzed.reduce<DailyStrategyPoint | null>((current, point) => {
    if (!current || current.differenceValue === null) {
      return point;
    }

    return Math.abs(point.differenceValue as number) >
      Math.abs(current.differenceValue)
      ? point
      : current;
  }, null);

  return {
    analyzedDays: analyzed.length,
    referenceMoreExpensiveDays: analyzed.filter(
      (point) => (point.differenceValue as number) > 0,
    ).length,
    referenceCheaperDays: analyzed.filter(
      (point) => (point.differenceValue as number) < 0,
    ).length,
    largestDifference:
      largest?.differenceValue === null || !largest
        ? null
        : { value: largest.differenceValue, date: largest.date },
  };
}

export function buildPricingResult(
  params: ValidatedPricingSearch,
  providerDays: ProviderDailyResult[],
): PricingSearchResult {
  const days = providerDays.map(enrichDay);
  const strategy = days.map(buildDailyStrategy);

  return {
    params,
    days,
    strategy,
    summary: buildPricingSummary(strategy),
  };
}
