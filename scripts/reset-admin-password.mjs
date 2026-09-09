import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "admin@analyticsbi.com.br";

function requiredEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`A variável temporária ${name} não foi informada.`);
  }

  return value;
}

async function findAdminUser(adminClient) {
  let page = 1;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) {
      throw new Error("Não foi possível consultar os usuários do Supabase Auth.");
    }

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === ADMIN_EMAIL,
    );

    if (user) {
      return user;
    }

    if (data.users.length < 1000) {
      return null;
    }

    page += 1;
  }
}

async function main() {
  const password = requiredEnvironmentVariable("ADMIN_RESET_PASSWORD");
  const supabaseUrl = requiredEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requiredEnvironmentVariable("SUPABASE_SECRET_KEY");

  if (password.length < 6 || password.length > 72) {
    throw new Error("A nova senha deve ter entre 6 e 72 caracteres.");
  }

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const adminUser = await findAdminUser(adminClient);

  if (!adminUser) {
    throw new Error("O usuário administrador informado não foi localizado.");
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role")
    .eq("id", adminUser.id)
    .eq("email", ADMIN_EMAIL)
    .maybeSingle();

  if (profileError || !profile || profile.role !== "admin") {
    throw new Error("O profile administrativo correspondente não foi validado.");
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    adminUser.id,
    { password },
  );

  if (updateError) {
    throw new Error("O Supabase não conseguiu atualizar a senha do administrador.");
  }

  console.log("Senha do administrador atualizada com sucesso.");
  console.log(
    "Remova ADMIN_RESET_PASSWORD do ambiente e exclua este script temporário quando terminar.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha inesperada.");
  process.exitCode = 1;
});
