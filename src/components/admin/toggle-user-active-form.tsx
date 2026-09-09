"use client";

import { useActionState } from "react";

import { toggleUserActiveAction } from "@/app/actions/users";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = { status: "idle", message: "" };

interface ToggleUserActiveFormProps {
  userId: string;
  active: boolean;
  isCurrentUser: boolean;
}

export function ToggleUserActiveForm({
  userId,
  active,
  isCurrentUser,
}: ToggleUserActiveFormProps) {
  const [state, formAction, pending] = useActionState(
    toggleUserActiveAction,
    initialState,
  );
  const cannotDeactivate = isCurrentUser && active;

  return (
    <form action={formAction} className="max-w-56">
      <input name="userId" type="hidden" value={userId} />
      <input name="active" type="hidden" value={String(!active)} />
      <button
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={pending || cannotDeactivate}
        title={
          cannotDeactivate
            ? "A conta atual não pode desativar a si mesma."
            : undefined
        }
        type="submit"
      >
        {pending ? "Salvando..." : active ? "Desativar" : "Ativar"}
      </button>
      {state.message && (
        <p
          aria-live="polite"
          className={`mt-2 text-xs ${state.status === "error" ? "text-red-800" : "text-emerald-800"}`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
