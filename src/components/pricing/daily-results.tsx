import {
  formatLongDate,
  formatNightRange,
} from "@/components/pricing/formatters";
import { HotelRateCard } from "@/components/pricing/hotel-rate-card";
import type { DailyPricingResult } from "@/types/pricing";

export function DailyResults({ days }: { days: DailyPricingResult[] }) {
  return (
    <div className="space-y-7">
      {days.map((day) => (
        <section aria-labelledby={`day-${day.date}`} key={day.date}>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">
                Diária {formatNightRange(day.date)}
              </p>
              <h2
                className="mt-1 text-xl font-bold capitalize text-slate-950"
                id={`day-${day.date}`}
              >
                {formatLongDate(day.date)}
              </h2>
            </div>
            <p className="text-xs text-slate-500">Clique em um hotel para ver as ofertas</p>
          </div>

          <div aria-hidden="true" className="mb-2 hidden grid-cols-[minmax(180px,1.25fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-4 px-4 text-xs font-bold uppercase tracking-wider text-slate-600 sm:grid">
            <span>Hotel</span>
            <span>Site</span>
            <span>Trivago</span>
          </div>

          <div className="space-y-2">
            {day.hotels.map((rate) => (
              <HotelRateCard key={rate.hotelId} rate={rate} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
