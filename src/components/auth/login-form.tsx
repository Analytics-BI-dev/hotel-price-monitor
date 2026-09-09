"use client";

import { useActionState, useEffect } from "react";

import { signInAction } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = { status: "idle", message: "" };

interface LoginFormProps {
  sessionReason?: "inactive" | "access";
}

export function LoginForm({ sessionReason }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  useEffect(() => {
    if (sessionReason) {
      void createClient().auth.signOut();
    }
  }, [sessionReason]);

  const reasonMessage =
    sessionReason === "inactive"
      ? "Este usuário está desativado."
      : sessionReason === "access"
        ? "Este usuário não possui um perfil de acesso válido."
        : "";

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-slate-800"
          htmlFor="email"
        >
          Usuário
        </label>
        <input
          autoComplete="username"
          autoFocus
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-3 focus:ring-red-100"
          id="email"
          name="email"
          placeholder="usuario@empresa.local"
          required
          type="email"
        />
      </div>

      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-slate-800"
          htmlFor="password"
        >
          Senha
        </label>
        <input
          autoComplete="current-password"
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-red-600 focus:ring-3 focus:ring-red-100"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>

      {(state.message || reasonMessage) && (
        <p
          aria-live="polite"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          role="alert"
        >
          {state.message || reasonMessage}
        </p>
      )}

      <button
        className="w-full rounded-lg bg-red-700 px-4 py-2.5 font-semibold text-white transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
