import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getAuthenticatedProfile } from "@/lib/auth/profile";
import { getProfileAccess } from "@/lib/auth/profile-access";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ reason?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const authenticatedProfile = await getAuthenticatedProfile();

  if (getProfileAccess(authenticatedProfile?.profile) === "allowed") {
    redirect("/dashboard");
  }

  const sessionReason =
    params.reason === "inactive" || params.reason === "access"
      ? params.reason
      : undefined;

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-white px-5 py-12">
      <div className="absolute inset-x-0 top-0 h-1 bg-red-700" />
      <section className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-red-700 text-lg font-bold text-white">
            H
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Hotel Price Monitor
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Acesse a plataforma para consultar tarifas.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm sessionReason={sessionReason} />
        </div>
      </section>
    </main>
  );
}
