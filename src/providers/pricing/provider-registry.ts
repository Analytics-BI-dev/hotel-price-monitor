import "server-only";

import { HybridPricingProvider } from "./hybrid-pricing-provider.ts";
import { UnconfiguredPricingProvider } from "./unconfigured-pricing-provider.ts";
import { CuriExecutiveOfficialProvider } from "./official-sites/curi-executive.ts";
import { CuriPalaceOfficialProvider } from "./official-sites/curi-palace.ts";
import {
  externalLinkOnlyOfficialHotelConfigs,
  ExternalLinkOnlyOfficialProvider,
} from "./official-sites/external-link-only.ts";
import { IbisPelotasOfficialProvider } from "./official-sites/ibis-pelotas.ts";
import { trivagoHotelConfigs } from "./trivago/hotel-configs.ts";
import { createTrivagoJsonProviderMap } from "./trivago/trivago-json-provider.ts";
import { TrivagoJsonRepository } from "./trivago/trivago-json-repository.ts";
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
export const pricingProvider: PricingProvider = {
  name: "hybrid",
  search(params, hotels) {
    // Every invocation gets its own download, including simultaneous searches
    // with identical parameters. Official providers keep their existing lifetime.
    const repository = new TrivagoJsonRepository();
    return new HybridPricingProvider(
      new UnconfiguredPricingProvider(),
      officialSiteProviders,
      createTrivagoJsonProviderMap(trivagoHotelConfigs, repository),
    ).search(params, hotels);
  },
};
