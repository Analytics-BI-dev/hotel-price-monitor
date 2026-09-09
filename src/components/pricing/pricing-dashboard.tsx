"use client";

import { unstable_rethrow } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";

import { searchPricesAction } from "@/app/actions/pricing";
import { DailyResults } from "@/components/pricing/daily-results";
import { StrategyChart } from "@/components/pricing/strategy-chart";
import {
  addDays,
  validatePricingSearch,
} from "@/services/pricing/validation";
import type { PricingActionState, PricingSearchInput } from "@/types/pricing";

const INITIAL_STATE: PricingActionState = {
  status: "idle",
  message: "",
  result: null,
};

interface PricingDashboardProps {
  initialCheckIn: string;
  initialCheckOut: string;
}

export function PricingDashboard({
  initialCheckIn,
  initialCheckOut,
}: PricingDashboardProps) {
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [adults, setAdults] = useState<1 | 2>(1);
  const [state, setState] = useState(INITIAL_STATE);
  const [isPending, startTransition] = useTransition();
  const searchInFlight = useRef(false);

  const checkOutMinimum = addDays(checkIn, 1);
  const checkOutMaximum = addDays(checkIn, 10);
  function handleCheckInChange(value: string) {
    setCheckIn(value);

    if (value && (checkOut <= value || checkOut > addDays(value, 10))) {
      setCheckOut(addDays(value, 1));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchInFlight.current) return;

    const input: PricingSearchInput = {
      checkIn,
      checkOut,
      adults,
      rooms: 1,
      children: 0,
    };
    const validation = validatePricingSearch(input, initialCheckIn);

    if (!validation.success) {
      setState({ status: "error", message: validation.message, result: null });
      return;
    }

    const formData = new FormData(event.currentTarget);
    searchInFlight.current = true;
    setState((current) => ({ ...current, status: "idle", message: "" }));
    startTransition(async () => {
      try {
        const nextState = await searchPricesAction(formData);
        setState(nextState);
      } catch (error) {
        unstable_rethrow(error);
        setState({
          status: "error",
          message: "Não foi possível concluir a busca. Verifique sua conexão e tente novamente.",
          result: null,
        });
      } finally {
        searchInFlight.current = false;
      }
    });
  }

  return (
    <div className="space-y-7">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <form aria-busy={isPending} className="grid gap-5 lg:grid-cols-[1fr_1fr_240px_auto] lg:items-start" onSubmit={handleSubmit}>
          <label className="block lg:grid lg:grid-rows-[auto_auto_1rem] lg:gap-y-2">
            <span className="mb-2 block text-sm font-bold text-slate-800 lg:mb-0">Check-in</span>
            <span className="block lg:flex lg:min-h-11 lg:items-end">
              <input
                className="field"
                disabled={isPending}
                min={initialCheckIn}
                name="checkIn"
                onChange={(event) => handleCheckInChange(event.target.value)}
                required
                type="date"
                value={checkIn}
              />
            </span>
            <span aria-hidden="true" className="invisible hidden text-xs lg:block">
              Máximo de 10 diárias
            </span>
          </label>

          <label className="block lg:grid lg:grid-rows-[auto_auto_1rem] lg:gap-y-2">
            <span className="mb-2 block text-sm font-bold text-slate-800 lg:mb-0">Check-out</span>
            <span className="block lg:flex lg:min-h-11 lg:items-end">
              <input
                aria-describedby="checkout-help"
                className="field"
                disabled={isPending}
                max={checkOutMaximum}
                min={checkOutMinimum}
                name="checkOut"
                onChange={(event) => setCheckOut(event.target.value)}
                required
                type="date"
                value={checkOut}
              />
            </span>
            <span className="mt-1.5 block text-xs text-slate-500 lg:mt-0" id="checkout-help">Máximo de 10 diárias</span>
          </label>

          <div className="lg:grid lg:grid-rows-[auto_auto_1rem] lg:gap-y-2">
            <span className="mb-2 block text-sm font-bold text-slate-800 lg:mb-0" id="adults-label">Adultos</span>
            <input name="adults" type="hidden" value={adults} />
            <div aria-describedby="adults-help" aria-labelledby="adults-label" className="grid grid-cols-2 gap-2 lg:min-h-11 lg:items-end" role="group">
              {([1, 2] as const).map((value) => (
                <button
                  aria-pressed={adults === value}
                  disabled={isPending}
                  className={`rounded-lg border px-4 py-2.5 text-sm font-bold transition ${
                    adults === value
                      ? "border-red-700 bg-red-50 text-red-800 ring-1 ring-red-700"
                      : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                  }`}
                  key={value}
                  onClick={() => setAdults(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
            <span className="mt-1.5 block text-xs text-slate-500 lg:mt-0" id="adults-help">1 quarto · sem crianças</span>
          </div>

          <div className="lg:grid lg:grid-rows-[auto_auto_1rem] lg:gap-y-2">
            <span aria-hidden="true" className="invisible hidden text-sm font-bold lg:block">
              Buscar preços
            </span>
            <span className="block lg:flex lg:min-h-11 lg:items-end">
              <button
                className="min-h-11 rounded-lg bg-red-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-65"
                disabled={isPending}
                type="submit"
              >
                {isPending ? "Buscando preços..." : "Buscar preços"}
              </button>
            </span>
            <span aria-hidden="true" className="invisible hidden text-xs lg:block">
              Máximo de 10 diárias
            </span>
          </div>
        </form>

        {state.status === "error" && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-800" role="alert">
            {state.message}
          </p>
        )}
      </section>

      {isPending && (
        <section
          aria-live="polite"
          className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm"
        >
          <span aria-hidden="true" className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-red-700" />
          <p className="mt-4 font-bold text-slate-900">Buscando preços...</p>
          <p className="mt-1 text-sm text-slate-500">Comparando cada diária do período selecionado.</p>
        </section>
      )}

      {!isPending && state.result && (
        <div className="space-y-8">
          <StrategyChart points={state.result.strategy} summary={state.result.summary} />
          <DailyResults days={state.result.days} />
        </div>
      )}

      {!isPending && !state.result && state.status !== "error" && (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="text-sm font-bold text-slate-800">Pronto para comparar</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
            Escolha o período e a ocupação para comparar os preços disponíveis, dia a dia, dos sete hotéis.
          </p>
        </section>
      )}
    </div>
  );
}
