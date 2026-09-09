"use client";

import { useId, useState } from "react";

import {
  formatCurrency,
  formatPercent,
} from "@/components/pricing/formatters";
import {
  getComparisonPresentation,
  getTrivagoOfferPresentation,
  hasOfferDetails,
  isExternalLinkOnlyOfficialSite,
} from "@/components/pricing/presentation";
import type {
  DailyHotelRate,
  HotelOffer,
  PriceComparison,
  SourceResult,
} from "@/types/pricing";

function SearchLink({ result }: { result: SourceResult }) {
  if (!result.searchUrl) return null;

  return (
    <a
      aria-label={`Abrir pesquisa ${result.source === "trivago" ? "no Trivago" : "no site oficial"} em nova aba`}
      className="mt-1 inline-flex rounded-sm text-xs font-semibold text-red-700 underline-offset-2 hover:underline"
      href={result.searchUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      Abrir pesquisa ↗
    </a>
  );
}

function SourcePrice({
  result,
  comparison,
  isReferenceHotel,
}: {
  result: SourceResult;
  comparison: PriceComparison | null;
  isReferenceHotel: boolean;
}) {
  if (isExternalLinkOnlyOfficialSite(result)) {
    return <SearchLink result={result} />;
  }

  return (
    <div>
      {result.status === "success" && result.bestPrice !== null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-base font-bold text-slate-950">
            {formatCurrency(result.bestPrice)}
          </p>
          <Comparison
            comparison={comparison}
            isReferenceHotel={isReferenceHotel}
          />
        </div>
      ) : result.status === "error" ? (
        <p className="text-sm font-bold text-red-700">Erro</p>
      ) : result.status === "unavailable" ? (
        <p className="text-sm font-bold text-slate-500">Indisponível</p>
      ) : (
        <p className="text-base font-bold text-slate-400">—</p>
      )}
      {result.status === "manual_verification_required" && (
        <p className="mt-0.5 text-xs font-medium text-amber-700">
          Verificação manual
        </p>
      )}
      {result.status === "success" && result.source === "trivago" && (
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {result.bestProvider ?? "Fonte não identificada"}
        </p>
      )}
      <SearchLink result={result} />
    </div>
  );
}

function breakfastLabel(value: boolean): string {
  if (value === true) return "Café incluso";
  return "Sem café";
}

function OfferRow({
  offer,
  trivagoOnly,
}: {
  offer: HotelOffer;
  trivagoOnly: boolean;
}) {
  if (trivagoOnly) {
    const presentation = getTrivagoOfferPresentation(offer);

    return (
      <li className="grid gap-2 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="min-w-0 truncate font-semibold text-slate-900">
          {presentation.providerName}
        </p>
        <p className="font-bold text-slate-950">
          {formatCurrency(presentation.price)}
        </p>
      </li>
    );
  }

  return (
    <li className="grid gap-2 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        {offer.roomName && (
          <p className="mt-0.5 font-semibold text-slate-900">{offer.roomName}</p>
        )}
        {offer.rateName && (
          <p className="mt-0.5 text-xs font-medium text-slate-600">
            {offer.rateName}
          </p>
        )}
        {offer.detailsText && (
          <p className="mt-0.5 text-xs text-slate-500">
            {offer.detailsText}
          </p>
        )}
        {offer.breakfastIncluded !== null && (
          <p className="mt-0.5 text-xs text-slate-500">
            {breakfastLabel(offer.breakfastIncluded)}
          </p>
        )}
        {offer.refundable === true && (
          <p className="mt-0.5 text-xs text-slate-500">Reembolsável</p>
        )}
        {offer.refundable === false && (
          <p className="mt-0.5 text-xs text-slate-500">Não reembolsável</p>
        )}
        {!hasOfferDetails(offer) && (
          <p className="mt-0.5 text-xs text-slate-500">
            Informação não disponível
          </p>
        )}
      </div>
      <p className="font-bold text-slate-950">{formatCurrency(offer.price)}</p>
    </li>
  );
}

function OffersSection({
  title,
  result,
}: {
  title: string;
  result: SourceResult;
}) {
  const showOnlySearchLink = isExternalLinkOnlyOfficialSite(result);

  if (showOnlySearchLink) {
    return (
      <section>
        <h4 className="font-bold text-slate-900">{title}</h4>
        <SearchLink result={result} />
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-bold text-slate-900">{title}</h4>
        {result.status === "success" && (
          <span className="text-xs text-slate-500">
            {result.offers.length} {result.offers.length === 1 ? "oferta" : "ofertas"}
          </span>
        )}
      </div>
      {result.status === "success" && result.offers.length > 0 ? (
        <ul className="mt-2">
          {result.offers.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              trivagoOnly={result.source === "trivago"}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          {result.status === "manual_verification_required"
            ? "Verificação manual necessária"
            : result.status === "error"
              ? "Falha na consulta"
              : "Não disponível"}
        </p>
      )}
    </section>
  );
}

function Comparison({
  comparison,
  isReferenceHotel,
}: {
  comparison: PriceComparison | null;
  isReferenceHotel: boolean;
}) {
  const presentation = getComparisonPresentation(
    isReferenceHotel,
    comparison,
  );

  if (presentation.kind !== "difference" || !comparison) return null;
  const { differenceValue, differencePercent } = comparison;
  const isPositive = presentation.tone === "positive";
  const colorClass = isPositive ? "text-emerald-700" : "text-red-700";
  const description = `${formatCurrency(Math.abs(differenceValue))} ${differenceValue > 0 ? "acima" : "abaixo"} do Curi Executive na mesma fonte`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${colorClass}`}
      title={description}
    >
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        viewBox="0 0 16 16"
      >
        <path
          d={
            presentation.direction === "up"
              ? "M3.5 10.5 8 6l4.5 4.5M8 6v7"
              : "M3.5 5.5 8 10l4.5-4.5M8 3v7"
          }
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.75"
        />
      </svg>
      <span className="sr-only">{description}: </span>
      {formatPercent(differencePercent)}
    </span>
  );
}

export function HotelRateCard({ rate }: { rate: DailyHotelRate }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const titleId = `${id}-title`;
  const offersId = `${id}-offers`;

  return (
    <article
      aria-labelledby={titleId}
      className={`overflow-hidden rounded-xl border bg-white transition ${
        rate.isReferenceHotel
          ? "border-red-200 shadow-[0_1px_0_rgba(185,28,28,0.08)]"
          : "border-slate-200"
      }`}
    >
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(180px,1.25fr)_minmax(150px,1fr)_minmax(150px,1fr)] sm:items-center">
        <div className="min-w-0">
          <h3 id={titleId}>
            <button
              aria-controls={offersId}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Ocultar" : "Ver"} ofertas de ${rate.hotelName}`}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left font-bold text-slate-950 transition hover:bg-slate-50"
              onClick={() => setExpanded((current) => !current)}
              type="button"
            >
              <span aria-hidden="true" className={`shrink-0 text-lg text-slate-500 transition ${expanded ? "rotate-180" : ""}`}>
                ⌄
              </span>
              <span className="min-w-0">{rate.hotelName}</span>
            </button>
          </h3>
          {rate.isReferenceHotel && (
            <span className="ml-5 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
              Seu hotel
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-600 sm:sr-only">
            Site
          </p>
          <SourcePrice
            comparison={rate.comparisonBySource.official_site}
            isReferenceHotel={rate.isReferenceHotel}
            result={rate.officialSite}
          />
        </div>

        <div className="min-w-0">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-600 sm:sr-only">
            Trivago
          </p>
          <SourcePrice
            comparison={rate.comparisonBySource.trivago}
            isReferenceHotel={rate.isReferenceHotel}
            result={rate.trivago}
          />
        </div>
      </div>

      <div hidden={!expanded} id={offersId}>
        <div className="grid gap-7 border-t border-slate-100 bg-slate-50/50 px-5 py-5 md:grid-cols-2">
          <OffersSection title="Site oficial" result={rate.officialSite} />
          <OffersSection title="Trivago" result={rate.trivago} />
        </div>
      </div>
    </article>
  );
}
