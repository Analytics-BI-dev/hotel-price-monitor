"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/types/actions";

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  username: z.string().trim().toLowerCase().email(),
  password: z.string().min(6).max(72),
});

const toggleUserSchema = z.object({
  userId: z.string().uuid(),
  active: z.enum(["true", "false"]),
});

const resetUserPasswordSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(6).max(72),
  confirmPassword: z.string().min(6).max(72),
});

export async function createUserAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message:
        "Revise os dados. A senha deve ter entre 6 e 72 caracteres.",
    };
  }

  const admin = createAdminClient();
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email: parsed.data.username,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { name: parsed.data.name },
    });

  if (authError || !authData.user) {
    const duplicateUser =
      authError?.code === "email_exists" ||
      authError?.code === "user_already_exists";

    return {
      status: "error",
      message: duplicateUser
        ? "Já existe um usuário com este identificador."
        : "Não foi possível criar o usuário. Tente novamente.",
    };
  }

  let profileExists = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profile) {
      profileExists = true;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }

  if (!profileExists) {
    const { error: insertError } = await admin.from("profiles").insert({
      id: authData.user.id,
      name: parsed.data.name,
      email: parsed.data.username,
      role: "client",
      active: true,
    });

    if (insertError) {
      const { data: profileAfterConflict } = await admin
        .from("profiles")
        .select("id")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (!profileAfterConflict) {
        return {
          status: "error",
          message:
            "O acesso foi criado, mas o profile não pôde ser confirmado. Verifique o trigger do Supabase.",
        };
      }
    }
  }

  const { data: updatedProfile, error: profileError } = await admin
    .from("profiles")
    .update({
      name: parsed.data.name,
      email: parsed.data.username,
      role: "client",
      active: true,
    })
    .eq("id", authData.user.id)
    .select("id")
    .maybeSingle();

  if (profileError || !updatedProfile) {
    return {
      status: "error",
      message: "O usuário foi criado, mas o profile não pôde ser atualizado.",
    };
  }

  revalidatePath("/admin/users");

  return { status: "success", message: "Usuário criado com sucesso." };
}

export async function toggleUserActiveAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const currentAdmin = await requireAdmin();
  const parsed = toggleUserSchema.safeParse({
    userId: formData.get("userId"),
    active: formData.get("active"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Não foi possível validar o usuário." };
  }

  const nextActiveState = parsed.data.active === "true";

  if (parsed.data.userId === currentAdmin.user.id && !nextActiveState) {
    return { status: "error", message: "Você não pode desativar a própria conta." };
  }

  const admin = createAdminClient();
  const { data: updatedProfile, error } = await admin
    .from("profiles")
    .update({ active: nextActiveState })
    .eq("id", parsed.data.userId)
    .select("id")
    .maybeSingle();

  if (error || !updatedProfile) {
    return {
      status: "error",
      message: "Não foi possível atualizar o acesso. Tente novamente.",
    };
  }

  revalidatePath("/admin/users");
  return {
    status: "success",
    message: nextActiveState ? "Usuário ativado." : "Usuário desativado.",
  };
}

export async function resetUserPasswordAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const parsed = resetUserPasswordSchema.safeParse({
    userId: formData.get("userId"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "A nova senha deve ter entre 6 e 72 caracteres.",
    };
  }

  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return {
      status: "error",
      message: "A nova senha e a confirmação devem ser iguais.",
    };
  }

  const admin = createAdminClient();
  const { data: targetProfile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (profileError || !targetProfile) {
    return {
      status: "error",
      message: "Não foi possível localizar o usuário.",
    };
  }

  const { error } = await admin.auth.admin.updateUserById(
    parsed.data.userId,
    { password: parsed.data.newPassword },
  );

  if (error) {
    return {
      status: "error",
      message: "Não foi possível atualizar a senha. Tente novamente.",
    };
  }

  return { status: "success", message: "Senha atualizada com sucesso." };
}
