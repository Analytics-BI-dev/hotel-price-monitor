import assert from "node:assert/strict";
import test from "node:test";

import { formatNightRange } from "../src/components/pricing/formatters.ts";
import {
  getComparisonPresentation,
  getTrivagoOfferPresentation,
  hasOfferDetails,
  isExternalLinkOnlyOfficialSite,
} from "../src/components/pricing/presentation.ts";
import type { HotelOffer, SourceResult } from "../src/types/pricing.ts";

function source(
  status: SourceResult["status"],
  searchUrl: string | null,
): SourceResult {
  return {
    source: "official_site",
    status,
    bestPrice: null,
    bestProvider: null,
    searchUrl,
    offers: [],
  };
}

test("formata uma diária usando a data da diária e o dia seguinte", () => {
  assert.equal(formatNightRange("2026-08-28"), "28/08 → 29/08");
});

test("formata todas as diárias de um período sem deslocamento", () => {
  assert.deepEqual(
    ["2026-08-28", "2026-08-29", "2026-08-30"].map(formatNightRange),
    ["28/08 → 29/08", "29/08 → 30/08", "30/08 → 31/08"],
  );
});

test("calcula corretamente viradas de mês e ano", () => {
  assert.deepEqual(
    ["2026-08-30", "2026-08-31", "2026-09-01"].map(formatNightRange),
    ["30/08 → 31/08", "31/08 → 01/09", "01/09 → 02/09"],
  );
  assert.deepEqual(
    ["2026-12-31", "2027-01-01"].map(formatNightRange),
    ["31/12 → 01/01", "01/01 → 02/01"],
  );
});

test("reconhece o site oficial configurado somente como link externo", () => {
  const desbravadorUrl =
    "https://reservas.desbravador.com.br/hotel-app/m-tower-hotel/reservation?checkin=2026-09-01&checkout=2026-09-02&adults=1";

  assert.equal(
    isExternalLinkOnlyOfficialSite(source("link_only", desbravadorUrl)),
    true,
  );

  assert.equal(
    isExternalLinkOnlyOfficialSite({
      ...source("success", desbravadorUrl),
      bestPrice: 280,
    }),
    false,
  );
  assert.equal(
    isExternalLinkOnlyOfficialSite(
      source("error", "https://outro-provider.example/reservation"),
    ),
    false,
  );
  assert.equal(
    isExternalLinkOnlyOfficialSite(source("unavailable", desbravadorUrl)),
    false,
  );
  assert.equal(
    isExternalLinkOnlyOfficialSite(source("link_only", "https://hotel.example/reservation")),
    true,
  );
  assert.equal(
    isExternalLinkOnlyOfficialSite({ ...source("link_only", desbravadorUrl), source: "trivago" }),
    false,
  );
});

test("concorrente acima é positivo com seta para cima", () => {
  assert.deepEqual(
    getComparisonPresentation(false, {
      differenceValue: 35,
      differencePercent: 12.3,
    }),
    { kind: "difference", direction: "up", tone: "positive" },
  );
});

test("concorrente abaixo é negativo com seta para baixo", () => {
  assert.deepEqual(
    getComparisonPresentation(false, {
      differenceValue: -4,
      differencePercent: -1.4,
    }),
    { kind: "difference", direction: "down", tone: "negative" },
  );
});

test("hotel do cliente permanece como referência", () => {
  assert.deepEqual(
    getComparisonPresentation(true, {
      differenceValue: 35,
      differencePercent: 12.3,
    }),
    { kind: "reference" },
  );
});

test("informação indisponível aparece somente sem qualquer detalhe confiável", () => {
  const offer: HotelOffer = {
    id: "offer",
    source: "trivago",
    providerName: "Agoda",
    roomName: null,
    rateName: null,
    detailsText: null,
    breakfastIncluded: null,
    refundable: null,
    price: 281,
    currency: "BRL",
  };

  assert.equal(hasOfferDetails(offer), false);
  assert.equal(
    hasOfferDetails({ ...offer, detailsText: "Cancelamento gratuito" }),
    true,
  );
  assert.equal(hasOfferDetails({ ...offer, breakfastIncluded: false }), true);
  assert.equal(hasOfferDetails({ ...offer, refundable: false }), true);
});

test("Trivago com duas ofertas expõe somente fonte e preço na apresentação", () => {
  const offers: HotelOffer[] = [
    {
      id: "agoda",
      source: "trivago",
      providerName: "Agoda",
      roomName: "Quarto Deluxe",
      rateName: "Tarifa flexível",
      detailsText: "Cancelamento gratuito até 30/08",
      breakfastIncluded: true,
      refundable: true,
      price: 245,
      currency: "BRL",
    },
    {
      id: "booking",
      source: "trivago",
      providerName: "Booking.com",
      roomName: null,
      rateName: null,
      detailsText: "Informação não disponível",
      breakfastIncluded: null,
      refundable: null,
      price: 249,
      currency: "BRL",
    },
  ];

  assert.deepEqual(offers.map(getTrivagoOfferPresentation), [
    { providerName: "Agoda", price: 245 },
    { providerName: "Booking.com", price: 249 },
  ]);
});

test("Trivago com três ofertas preserva a ordem e não cria campos adicionais", () => {
  const baseOffer: HotelOffer = {
    id: "offer",
    source: "trivago",
    providerName: "Agoda",
    roomName: null,
    rateName: null,
    detailsText: null,
    breakfastIncluded: null,
    refundable: null,
    price: 245,
    currency: "BRL",
  };
  const offers: HotelOffer[] = [
    baseOffer,
    { ...baseOffer, id: "booking", providerName: "Booking.com", price: 249 },
    { ...baseOffer, id: "hoteis", providerName: "Hoteis.com", price: 283 },
  ];

  assert.deepEqual(offers.map(getTrivagoOfferPresentation), [
    { providerName: "Agoda", price: 245 },
    { providerName: "Booking.com", price: 249 },
    { providerName: "Hoteis.com", price: 283 },
  ]);
});
