import type {
  HotelOffer,
  PriceComparison,
  SourceResult,
} from "@/types/pricing";

export type ComparisonPresentation =
  | { kind: "reference" }
  | { kind: "unavailable" }
  | { kind: "equal" }
  | {
      kind: "difference";
      direction: "up" | "down";
      tone: "positive" | "negative";
    };

export function getComparisonPresentation(
  isReferenceHotel: boolean,
  comparison: PriceComparison | null,
): ComparisonPresentation {
  if (isReferenceHotel) return { kind: "reference" };
  if (!comparison) return { kind: "unavailable" };
  if (comparison.differenceValue === 0) return { kind: "equal" };
  return comparison.differenceValue > 0
    ? { kind: "difference", direction: "up", tone: "positive" }
    : { kind: "difference", direction: "down", tone: "negative" };
}

export function hasOfferDetails(offer: HotelOffer): boolean {
  return Boolean(
    offer.roomName?.trim() ||
      offer.rateName?.trim() ||
      offer.detailsText?.trim() ||
      offer.breakfastIncluded !== null ||
      (offer.refundable !== null && offer.refundable !== undefined),
  );
}

export interface TrivagoOfferPresentation {
  providerName: string;
  price: number;
}

export function getTrivagoOfferPresentation(
  offer: HotelOffer,
): TrivagoOfferPresentation {
  return {
    providerName: offer.providerName?.trim() || "Trivago",
    price: offer.price,
  };
}

export function isExternalLinkOnlyOfficialSite(
  result: SourceResult,
): boolean {
  return result.source === "official_site" && result.status === "link_only";
}
