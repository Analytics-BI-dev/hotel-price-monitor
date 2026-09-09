import type { Metadata } from "next";
import Link from "next/link";

import { signOutAction } from "@/app/actions/auth";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { ResetPasswordModal } from "@/components/admin/reset-password-modal";
import { ToggleUserActiveForm } from "@/components/admin/toggle-user-active-form";
import { requireAdmin } from "@/lib/auth/profile";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Usuários" };
export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export default async function UsersPage() {
  const currentAdmin = await requireAdmin();
  const admin = createAdminClient();
  const { data: users, error } = await admin
    .from("profiles")
    .select("id, name, email, role, active, created_at")
    .order("created_at", { ascending: false });

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
              <p className="text-xs text-slate-500">Administração</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              className="rounded-lg px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              href="/dashboard"
            >
              Dashboard
            </Link>
            <form action={signOutAction}>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                type="submit"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-7">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-red-700">
            Administração
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">
            Usuários
          </h1>
          <p className="mt-2 text-slate-500">
            Cadastre clientes e controle quem pode acessar a plataforma.
          </p>
        </div>

        <details className="group mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-semibold text-slate-900 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-600">
            <span>Novo usuário</span>
            <span className="text-xl text-red-700 transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="border-t border-slate-200 p-5">
            <CreateUserForm />
          </div>
        </details>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {error ? (
            <p className="p-6 text-sm text-red-800">
              Não foi possível carregar os usuários.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-190 border-collapse text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold">Nome</th>
                    <th className="px-5 py-3.5 font-semibold">Usuário</th>
                    <th className="px-5 py-3.5 font-semibold">Perfil</th>
                    <th className="px-5 py-3.5 font-semibold">Status</th>
                    <th className="px-5 py-3.5 font-semibold">Criado em</th>
                    <th className="px-5 py-3.5 text-right font-semibold">
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users?.map((user) => {
                    const isCurrentUser = user.id === currentAdmin.user.id;

                    return (
                      <tr key={user.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4 font-semibold text-slate-900">
                          {user.name || "—"}
                          {isCurrentUser && (
                            <span className="ml-2 text-xs font-normal text-slate-400">
                              Você
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-slate-600">
                          {user.email}
                        </td>
                        <td className="px-5 py-4">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {user.role === "admin" ? "Admin" : "Cliente"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={
                              user.active
                                ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                                : "rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
                            }
                          >
                            {user.active ? "Ativo" : "Inativo"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-slate-500">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <ResetPasswordModal
                              name={user.name}
                              userId={user.id}
                              username={user.email}
                            />
                            <ToggleUserActiveForm
                              active={user.active}
                              isCurrentUser={isCurrentUser}
                              userId={user.id}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {!users?.length && (
                    <tr>
                      <td
                        className="px-5 py-10 text-center text-slate-500"
                        colSpan={6}
                      >
                        Nenhum usuário encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
