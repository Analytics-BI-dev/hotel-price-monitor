"use client";

import { useId, useState } from "react";

import {
  formatCurrency,
  formatPercent,
  formatShortDate,
  formatSignedCurrency,
} from "@/components/pricing/formatters";
import type {
  DailyStrategyPoint,
  PricingSummary,
} from "@/types/pricing";

interface StrategyChartProps {
  points: DailyStrategyPoint[];
  summary: PricingSummary;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-base font-bold text-slate-900">{value}</dd>
    </div>
  );
}

export function StrategyChart({ points, summary }: StrategyChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const tooltipId = useId();
  const activeIndex = hoveredIndex ?? focusedIndex;
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const maximumDifference = Math.max(
    1,
    ...points.map((point) => Math.abs(point.differenceValue ?? 0)),
  );

  return (
    <section
      aria-labelledby="strategy-title"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">
                Visão estratégica
              </p>
              <h2
                className="mt-1 text-xl font-bold tracking-tight text-slate-950"
                id="strategy-title"
              >
                Curi x concorrente mais barato
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Diferença diária em reais, sem médias do período.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-red-600" /> Curi mais caro
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Curi mais barato
              </span>
            </div>
          </div>

          <div
            className="relative overflow-x-auto rounded-xl border border-slate-100 bg-slate-50/60 px-3 pb-7 pt-8"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setHoveredIndex(null);
                setFocusedIndex(null);
              }
            }}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {activePoint?.status === "success" &&
              activePoint.referencePrice !== null &&
              activePoint.cheapestCompetitorPrice !== null &&
              activePoint.differenceValue !== null &&
              activePoint.differencePercent !== null && (
                <div
                  className="absolute right-3 top-3 z-20 w-64 max-w-[calc(100%-1.5rem)] rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-md"
                  id={tooltipId}
                  role="tooltip"
                >
                  <p className="font-bold text-slate-900">
                    {formatShortDate(activePoint.date)}
                  </p>
                  <dl className="mt-2 space-y-1 text-slate-600">
                    <div className="flex justify-between gap-3">
                      <dt>Hotel Curi Executive</dt>
                      <dd className="font-semibold text-slate-900">
                        {formatCurrency(activePoint.referencePrice)}
                      </dd>
                    </div>
                    <div className="pt-1">
                      <dt>Concorrente mais barato</dt>
                      <dd className="font-semibold text-slate-900">
                        {activePoint.cheapestCompetitorName}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Preço concorrente</dt>
                      <dd>{formatCurrency(activePoint.cheapestCompetitorPrice)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-slate-100 pt-1.5">
                      <dt>Diferença</dt>
                      <dd className="font-bold text-slate-900">
                        {formatSignedCurrency(activePoint.differenceValue)} ·{" "}
                        {formatPercent(activePoint.differencePercent)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

            <div
              className="relative h-48 min-w-115"
              aria-label="Gráfico de diferenças diárias"
              role="group"
            >
              <span className="absolute left-0 top-0 text-[10px] text-slate-500">
                +{formatCurrency(maximumDifference)}
              </span>
              <span className="absolute bottom-0 left-0 text-[10px] text-slate-500">
                −{formatCurrency(maximumDifference)}
              </span>
              <div className="absolute inset-x-12 top-1/2 h-px bg-slate-300" />
              <span className="absolute left-1 top-1/2 -translate-y-1/2 bg-slate-50 px-1 text-[10px] font-medium text-slate-500">
                R$ 0
              </span>

              <div className="absolute inset-y-0 left-12 right-2 flex items-stretch justify-around gap-1">
                {points.map((point, index) => {
                  const difference = point.differenceValue ?? 0;
                  const height =
                    point.status === "success"
                      ? Math.max(3, (Math.abs(difference) / maximumDifference) * 44)
                      : 0;
                  const isPositive = difference > 0;
                  const isEqual = difference === 0;

                  return (
                    <button
                      aria-describedby={activeIndex === index && point.status === "success" ? tooltipId : undefined}
                      aria-label={
                        point.status === "success"
                          ? `${formatShortDate(point.date)}: Curi ${formatCurrency(point.referencePrice ?? 0)}; ${point.cheapestCompetitorName} ${formatCurrency(point.cheapestCompetitorPrice ?? 0)}; diferença de ${formatSignedCurrency(difference)}`
                          : `${formatShortDate(point.date)}: comparação indisponível`
                      }
                      className="group relative h-full min-w-7 flex-1 rounded focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2"
                      key={point.date}
                      onBlur={() => setFocusedIndex(null)}
                      onClick={() => setFocusedIndex(index)}
                      onFocus={() => setFocusedIndex(index)}
                      onMouseEnter={() => setHoveredIndex(index)}
                      type="button"
                    >
                      {point.status === "success" && isEqual ? (
                        <span className="absolute left-1/2 top-1/2 h-1.5 w-5 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-500 group-focus-visible:ring-2 group-focus-visible:ring-red-700 group-focus-visible:ring-offset-2" />
                      ) : point.status === "success" ? (
                        <span
                          className={`absolute left-1/2 w-[58%] min-w-2 max-w-9 -translate-x-1/2 rounded-sm transition group-hover:brightness-95 group-focus-visible:ring-2 group-focus-visible:ring-red-700 group-focus-visible:ring-offset-2 ${
                            isPositive ? "bg-red-600" : "bg-emerald-600"
                          }`}
                          style={
                            isPositive
                              ? { bottom: "50%", height: `${height}%` }
                              : { top: "50%", height: `${height}%` }
                          }
                        />
                      ) : (
                        <span className="absolute left-1/2 top-1/2 h-1 w-4 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-300" />
                      )}
                      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-slate-500 sm:text-xs">
                        {formatShortDate(point.date)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2">
          <dl>
            <SummaryItem
              label="Dias analisados"
              value={String(summary.analyzedDays)}
            />
            <SummaryItem
              label="Curi mais caro"
              value={`${summary.referenceMoreExpensiveDays} dias`}
            />
            <SummaryItem
              label="Curi mais barato"
              value={`${summary.referenceCheaperDays} dias`}
            />
            <SummaryItem
              label="Maior diferença"
              value={
                summary.largestDifference
                  ? `${formatCurrency(Math.abs(summary.largestDifference.value))} em ${formatShortDate(summary.largestDifference.date)}`
                  : "—"
              }
            />
          </dl>
        </aside>
      </div>
    </section>
  );
}
