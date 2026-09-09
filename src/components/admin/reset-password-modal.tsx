"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { resetUserPasswordAction } from "@/app/actions/users";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = { status: "idle", message: "" };

interface ResetPasswordModalProps {
  userId: string;
  name: string | null;
  username: string;
}

interface ResetPasswordFormProps extends ResetPasswordModalProps {
  onClose: () => void;
}

function ResetPasswordForm({
  userId,
  name,
  username,
  onClose,
}: ResetPasswordFormProps) {
  const [state, formAction, pending] = useActionState(
    resetUserPasswordAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fieldSuffix = userId.replaceAll("-", "");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  function closeDialog() {
    dialogRef.current?.close();
    onClose();
  }

  return (
    <dialog
      aria-labelledby={`reset-password-title-${fieldSuffix}`}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl bg-white p-0 text-left shadow-xl backdrop:bg-slate-950/50"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) closeDialog();
      }}
      ref={dialogRef}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2
              className="text-lg font-bold text-slate-950"
              id={`reset-password-title-${fieldSuffix}`}
            >
              Redefinir senha
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Defina uma nova senha de acesso para este usuário.
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            disabled={pending}
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
        </div>

        <form ref={formRef} action={formAction} aria-busy={pending} className="space-y-4 p-5">
          <input name="userId" type="hidden" value={userId} />

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="font-semibold text-slate-900">{name || "Sem nome"}</p>
            <p className="mt-0.5 text-sm text-slate-500">{username}</p>
          </div>

          <div className="space-y-2">
            <label
              className="block text-sm font-semibold text-slate-800"
              htmlFor={`new-password-${fieldSuffix}`}
            >
              Nova senha
            </label>
            <input
              autoComplete="new-password"
              autoFocus
              className="field"
              disabled={pending}
              id={`new-password-${fieldSuffix}`}
              maxLength={72}
              minLength={6}
              name="newPassword"
              required
              type="password"
            />
          </div>

          <div className="space-y-2">
            <label
              className="block text-sm font-semibold text-slate-800"
              htmlFor={`confirm-password-${fieldSuffix}`}
            >
              Confirmar nova senha
            </label>
            <input
              autoComplete="new-password"
              className="field"
              disabled={pending}
              id={`confirm-password-${fieldSuffix}`}
              maxLength={72}
              minLength={6}
              name="confirmPassword"
              required
              type="password"
            />
          </div>

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

          <div className="flex justify-end gap-3 pt-1">
            <button
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              disabled={pending}
              onClick={closeDialog}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              type="submit"
            >
              {pending ? "Salvando..." : "Salvar nova senha"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

export function ResetPasswordModal(props: ResetPasswordModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
        onClick={() => setOpen(true)}
        type="button"
      >
        Redefinir senha
      </button>

      {open && (
        <ResetPasswordForm {...props} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
