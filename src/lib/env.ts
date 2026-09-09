import "server-only";

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`A variável de ambiente ${name} não está configurada.`);
  }

  return value;
}

export function getSupabaseServerEnvironment() {
  const url = getRequiredEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = getRequiredEnvironmentVariable(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const jwksUrl = getRequiredEnvironmentVariable("SUPABASE_JWKS_URL");

  const projectOrigin = new URL(url).origin;
  const configuredJwksUrl = new URL(jwksUrl);

  if (
    configuredJwksUrl.origin !== projectOrigin ||
    !configuredJwksUrl.pathname.endsWith("/.well-known/jwks.json")
  ) {
    throw new Error("SUPABASE_JWKS_URL não corresponde ao projeto configurado.");
  }

  return { url, publishableKey, jwksUrl };
}

export function getSupabaseAdminEnvironment() {
  const serverEnvironment = getSupabaseServerEnvironment();
  const secretKey = getRequiredEnvironmentVariable("SUPABASE_SECRET_KEY");

  return { ...serverEnvironment, secretKey };
}

