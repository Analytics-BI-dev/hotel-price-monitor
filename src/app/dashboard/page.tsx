import type { Metadata } from "next";
import Link from "next/link";

import { signOutAction } from "@/app/actions/auth";
import { PricingDashboard } from "@/components/pricing/pricing-dashboard";
import { requireActiveProfile } from "@/lib/auth/profile";
import {
  addDays,
  getTodayInSaoPaulo,
} from "@/services/pricing/validation";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Server Actions invoked by this page inherit this limit (Fluid Compute).
export const maxDuration = 300;

export default async function DashboardPage() {
  const { user, profile } = await requireActiveProfile();
  const roleLabel = profile.role === "admin" ? "Admin" : "Cliente";
  const today = getTodayInSaoPaulo();

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-700 font-bold text-white">
              H
            </div>
            <div>
              <p className="font-bold text-slate-950">Hotel Price Monitor</p>
              <p className="text-xs text-slate-500">Pelotas · RS</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {profile.role === "admin" && (
              <Link
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                href="/admin/users"
              >
                Usuários
              </Link>
            )}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-slate-800">
                {profile.name || user.email}
              </p>
              <p className="text-xs text-slate-500">{roleLabel}</p>
            </div>
            <form action={signOutAction}>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                type="submit"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-red-700">
              Dashboard
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">
              Consulta de Tarifas
            </h1>
            <p className="mt-2 text-slate-500">
              Bem-vindo, {profile.name || user.email}.
            </p>
          </div>

          <div className="text-sm text-slate-500">
            Compare o Hotel Curi Executive com seis concorrentes, diária por
            diária.
          </div>
        </div>

        <PricingDashboard
          initialCheckIn={today}
          initialCheckOut={addDays(today, 1)}
        />
      </section>
    </main>
  );
}
