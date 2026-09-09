"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { readLoginCredentials } from "@/lib/auth/login-credentials";
import { getProfileAccess } from "@/lib/auth/profile-access";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/types/actions";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signInAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const credentials = readLoginCredentials(formData);
  const parsed = loginSchema.safeParse(credentials);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Informe um usuário válido e a senha.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    if (error?.name === "AuthRetryableFetchError" || error?.status === 0) {
      return {
        status: "error",
        message:
          "Não foi possível conectar ao serviço de autenticação. Tente novamente.",
      };
    }

    return { status: "error", message: "Usuário ou senha inválidos." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", data.user.id)
    .maybeSingle();

  const access = getProfileAccess(profile);

  if (profileError || access === "missing" || access === "invalid_role") {
    await supabase.auth.signOut();
    return {
      status: "error",
      message: "Não foi possível validar o acesso deste usuário.",
    };
  }

  if (access === "inactive") {
    await supabase.auth.signOut();
    return { status: "error", message: "Este usuário está desativado." };
  }

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
