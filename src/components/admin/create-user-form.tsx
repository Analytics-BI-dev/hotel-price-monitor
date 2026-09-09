"use client";

import { useActionState, useEffect, useRef } from "react";

import { createUserAction } from "@/app/actions/users";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = { status: "idle", message: "" };

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(
    createUserAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} aria-busy={pending} className="space-y-4">
      <fieldset className="grid gap-4 md:grid-cols-2" disabled={pending}>
        <legend className="sr-only">Dados do novo usuário</legend>
        <div className="space-y-2 md:col-span-2">
          <label className="block text-sm font-semibold" htmlFor="name">
            Nome
          </label>
          <input
            className="field"
            id="name"
            maxLength={120}
            minLength={2}
            name="name"
            required
            type="text"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor="username">
            Usuário
          </label>
          <input
            className="field"
            id="username"
            name="username"
            placeholder="cliente@empresa.local"
            required
            type="email"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold" htmlFor="new-password">
            Senha
          </label>
          <input
            autoComplete="new-password"
            className="field"
            id="new-password"
            maxLength={72}
            minLength={6}
            name="password"
            required
            type="password"
          />
        </div>
      </fieldset>

      {state.message && (
        <p
          aria-live="polite"
          className={
            state.status === "success"
              ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
              : "rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          }
        >
          {state.message}
        </p>
      )}

      <button
        className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Criando..." : "Criar usuário"}
      </button>
    </form>
  );
}
