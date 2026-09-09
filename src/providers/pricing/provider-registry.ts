import "server-only";

import { HybridPricingProvider } from "@/providers/pricing/hybrid-pricing-provider";
import { UnconfiguredPricingProvider } from "@/providers/pricing/unconfigured-pricing-provider";
import { CuriExecutiveOfficialProvider } from "@/providers/pricing/official-sites/curi-executive";
import { CuriPalaceOfficialProvider } from "@/providers/pricing/official-sites/curi-palace";
import {
  externalLinkOnlyOfficialHotelConfigs,
  ExternalLinkOnlyOfficialProvider,
} from "@/providers/pricing/official-sites/external-link-only";
import { IbisPelotasOfficialProvider } from "@/providers/pricing/official-sites/ibis-pelotas";
import { trivagoHotelConfigs } from "@/providers/pricing/trivago/hotel-configs";
import { createTrivagoProviderMap } from "@/providers/pricing/trivago/trivago-pricing-provider";
import type {
  OfficialSitePricingProvider,
  PricingProvider,
} from "@/providers/pricing/types";

const curiExecutiveProvider = new CuriExecutiveOfficialProvider();
const curiPalaceProvider = new CuriPalaceOfficialProvider();
const ibisPelotasProvider = new IbisPelotasOfficialProvider();
const externalLinkOnlyProviders = externalLinkOnlyOfficialHotelConfigs.map(
  (config) => new ExternalLinkOnlyOfficialProvider(config),
);
const officialSiteProviders = new Map<string, OfficialSitePricingProvider>([
  [curiExecutiveProvider.hotelSlug, curiExecutiveProvider],
  [curiPalaceProvider.hotelSlug, curiPalaceProvider],
  [ibisPelotasProvider.hotelSlug, ibisPelotasProvider],
  ...externalLinkOnlyProviders.map(
    (provider) => [provider.hotelSlug, provider] as const,
  ),
]);
const trivagoProviders = createTrivagoProviderMap(trivagoHotelConfigs);

export const pricingProvider: PricingProvider = new HybridPricingProvider(
  new UnconfiguredPricingProvider(),
  officialSiteProviders,
  trivagoProviders,
);
