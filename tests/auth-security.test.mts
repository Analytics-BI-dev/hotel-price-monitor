import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import ts from "typescript";

import { getProfileAccess } from "../src/lib/auth/profile-access.ts";

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const idle = { status: "idle" as const, message: "" };
const adminId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";

// Execute the actual guards/actions with only their I/O replaced; no real Auth,
// environment variables, credentials, browser cookies or database are accessed.
function loadModule<T>(relativePath: string, mocks: Record<string, unknown>): T {
  const modules = new Map<string, { exports: unknown }>();
  function load(filename: string): unknown {
    const cached = modules.get(filename);
    if (cached) return cached.exports;
    const loadedModule = { exports: {} };
    modules.set(filename, loadedModule);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const resolve = (specifier: string): unknown => {
      if (specifier in mocks) return mocks[specifier];
      if (specifier === "server-only") return {};
      if (specifier.startsWith("@/")) {
        return load(path.join(projectRoot, "src", `${specifier.slice(2)}.ts`));
      }
      return require(specifier);
    };
    compileFunction(outputText, ["require", "module", "exports"], { filename })(
      resolve, loadedModule, loadedModule.exports,
    );
    return loadedModule.exports;
  }
  return load(path.join(projectRoot, relativePath)) as T;
}

class Redirect extends Error {
  readonly destination: string;
  constructor(destination: string) {
    super(destination);
    this.destination = destination;
  }
}
const navigation = { redirect(destination: string): never { throw new Redirect(destination); } };
function redirectedTo(destination: string) {
  return (error: unknown) => error instanceof Redirect && error.destination === destination;
}
function form(values: Record<string, string>) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

function adminHarness(options: {
  authenticated?: boolean; active?: unknown; role?: unknown;
  updateError?: boolean; missingTarget?: boolean;
  missingUpdatedProfile?: boolean;
  createError?: { code: string; status: number };
} = {}) {
  const calls = { adminClients: 0, profileId: "", updates: [] as unknown[], resets: [] as unknown[], revalidations: 0 };
  const authClient = {
    auth: { getClaims: async () => ({ data: options.authenticated === false ? null : { claims: { sub: adminId } }, error: null }) },
    from: () => ({
      select() { return this; },
      eq(_column: string, id: string) { calls.profileId = id; return this; },
      maybeSingle: async () => ({ data: { id: adminId, email: "admin@example.test", active: options.active ?? true, role: options.role ?? "admin" }, error: null }),
    }),
  };
  const adminClient = {
    auth: { admin: {
      createUser: async () => ({ data: { user: options.createError ? null : { id: targetId } }, error: options.createError ?? null }),
      updateUserById: async (...args: unknown[]) => { calls.resets.push(args); return { error: null }; },
    } },
    from: () => {
      const result = { data: options.missingTarget ? null : { id: targetId }, error: options.updateError ? { code: "08006" } : null };
      let updating = false;
      return {
        select() { return this; },
        eq() { return this; },
        update(value: unknown) { updating = true; calls.updates.push(value); return this; },
        maybeSingle: async () => updating && options.missingUpdatedProfile ? { data: null, error: null } : result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
    },
  };
  const mocks = {
    "next/navigation": navigation,
    "next/cache": { revalidatePath: () => { calls.revalidations++; } },
    "@/lib/supabase/server": { createClient: async () => authClient },
    "@/lib/supabase/admin": { createAdminClient: () => { calls.adminClients++; return adminClient; } },
  };
  return {
    calls,
    actions: loadModule<typeof import("../src/app/actions/users.ts")>("src/app/actions/users.ts", mocks),
    guards: loadModule<typeof import("../src/lib/auth/profile.ts")>("src/lib/auth/profile.ts", mocks),
  };
}

test("login e proteção compartilham a decisão para roles desconhecidas e active inválido", () => {
  assert.equal(getProfileAccess(null), "missing");
  assert.equal(getProfileAccess({ active: true, role: "owner" }), "invalid_role");
  assert.equal(getProfileAccess({ active: "true", role: "admin" }), "inactive");
  assert.equal(getProfileAccess({ active: true, role: "admin" }), "allowed");
  assert.equal(getProfileAccess({ active: true, role: "client" }), "allowed");
});

for (const scenario of [
  { name: "sem sessão", options: { authenticated: false }, destination: "/login" },
  { name: "admin inativo", options: { active: false }, destination: "/login?reason=inactive" },
  { name: "client ativo", options: { role: "client" }, destination: "/dashboard" },
  { name: "role desconhecida", options: { role: "owner" }, destination: "/login?reason=access" },
]) {
  test(`todas as ações administrativas bloqueiam ${scenario.name} antes do cliente privilegiado`, async () => {
    const { actions, calls } = adminHarness(scenario.options);
    await assert.rejects(actions.createUserAction(idle, new FormData()), redirectedTo(scenario.destination));
    await assert.rejects(actions.toggleUserActiveAction(idle, new FormData()), redirectedTo(scenario.destination));
    await assert.rejects(actions.resetUserPasswordAction(idle, new FormData()), redirectedTo(scenario.destination));
    assert.equal(calls.adminClients, 0);
  });
}

test("dashboard permite client ativo e localiza profile pelo subject validado", async () => {
  const { guards, calls } = adminHarness({ role: "client" });
  const authenticated = await guards.requireActiveProfile();
  assert.equal(authenticated.user.id, adminId);
  assert.equal(calls.profileId, adminId);
});

test("admin redefine exclusivamente a senha no Auth e não retorna dados sensíveis", async () => {
  const { actions, calls } = adminHarness();
  const password = "  Senha Fictícia 123!  ";
  const state = await actions.resetUserPasswordAction(idle, form({ userId: targetId, newPassword: password, confirmPassword: password }));
  assert.deepEqual(calls.resets, [[targetId, { password }]]);
  assert.deepEqual(calls.updates, []);
  assert.deepEqual(state, { status: "success", message: "Senha atualizada com sucesso." });
});

test("redefinição rejeita confirmação divergente e alvo inexistente", async () => {
  const { actions, calls } = adminHarness({ missingTarget: true });
  const mismatch = await actions.resetUserPasswordAction(idle, form({ userId: targetId, newPassword: "Exemplo123", confirmPassword: "Outro123" }));
  assert.equal(mismatch.status, "error");
  assert.equal(calls.adminClients, 0);
  const missing = await actions.resetUserPasswordAction(idle, form({ userId: targetId, newPassword: "Exemplo123", confirmPassword: "Exemplo123" }));
  assert.equal(missing.status, "error");
  assert.equal(calls.resets.length, 0);
});

test("admin não pode desativar a própria conta", async () => {
  const { actions, calls } = adminHarness();
  const state = await actions.toggleUserActiveAction(idle, form({ userId: adminId, active: "false" }));
  assert.equal(state.status, "error");
  assert.equal(calls.adminClients, 0);
});

test("ativação/desativação retorna erro em falha de banco ou usuário ausente", async () => {
  for (const options of [{ updateError: true }, { missingTarget: true }]) {
    const { actions, calls } = adminHarness(options);
    const state = await actions.toggleUserActiveAction(idle, form({ userId: targetId, active: "false" }));
    assert.equal(state.status, "error");
    assert.equal(calls.revalidations, 0);
  }
});

test("alteração de acesso confirmada atualiza somente active e revalida usuários", async () => {
  const { actions, calls } = adminHarness();
  const state = await actions.toggleUserActiveAction(idle, form({ userId: targetId, active: "false" }));
  assert.equal(state.status, "success");
  assert.deepEqual(calls.updates, [{ active: false }]);
  assert.equal(calls.revalidations, 1);
});

test("criação pelo admin mantém role client mesmo com campo adulterado", async () => {
  const { actions, calls } = adminHarness();
  const state = await actions.createUserAction(idle, form({ name: "Cliente Teste", username: "client@example.test", password: "Exemplo123", role: "admin" }));
  assert.equal(state.status, "success");
  assert.deepEqual(calls.updates, [{ name: "Cliente Teste", email: "client@example.test", role: "client", active: true }]);
});

test("erro 422 de política de senha não é exibido como usuário duplicado", async () => {
  const { actions } = adminHarness({ createError: { status: 422, code: "weak_password" } });
  const state = await actions.createUserAction(idle, form({ name: "Cliente Teste", username: "client@example.test", password: "Exemplo123" }));
  assert.equal(state.status, "error");
  assert.doesNotMatch(state.message, /Já existe/);
});

test("criação não anuncia sucesso quando atualização final do profile afeta zero linhas", async () => {
  const { actions, calls } = adminHarness({ missingUpdatedProfile: true });
  const state = await actions.createUserAction(idle, form({ name: "Cliente Teste", username: "client@example.test", password: "Exemplo123" }));
  assert.equal(state.status, "error");
  assert.match(state.message, /foi criado, mas/);
  assert.equal(calls.revalidations, 0);
});

test("login preserva senha, consulta profile pelo id Auth e só então redireciona", async () => {
  const password = "  Fictícia Com Espaços 123  ";
  let receivedCredentials: unknown;
  let selectedProfileId = "";
  const auth = loadModule<typeof import("../src/app/actions/auth.ts")>("src/app/actions/auth.ts", {
    "next/navigation": navigation,
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { signInWithPassword: async (credentials: unknown) => { receivedCredentials = credentials; return { data: { user: { id: adminId } }, error: null }; } },
      from: () => ({
        select() { return this; },
        eq(_column: string, id: string) { selectedProfileId = id; return this; },
        maybeSingle: async () => ({ data: { role: "admin", active: true }, error: null }),
      }),
    }) },
  });
  await assert.rejects(auth.signInAction(idle, form({ email: "  admin@example.test  ", password })), redirectedTo("/dashboard"));
  assert.deepEqual(receivedCredentials, { email: "admin@example.test", password });
  assert.equal(selectedProfileId, adminId);
});

test("proxy preserva cookies de sessão removidos ao redirecionar para login", async () => {
  const { NextRequest } = require("next/server") as typeof import("next/server");
  const proxy = loadModule<typeof import("../src/lib/supabase/proxy.ts")>("src/lib/supabase/proxy.ts", {
    "@/lib/env": { getSupabaseServerEnvironment: () => ({ url: "https://example.test", publishableKey: "test-publishable" }) },
    "@supabase/ssr": { createServerClient: (_url: string, _key: string, { cookies }: { cookies: { setAll: (values: unknown[]) => void } }) => ({
      auth: { getClaims: async () => {
        cookies.setAll([{ name: "test-session", value: "", options: { path: "/", maxAge: 0 } }]);
        cookies.setAll([{ name: "test-second", value: "", options: { path: "/", maxAge: 0 } }]);
        return { data: null, error: null };
      } },
    }) },
  });
  const response = await proxy.updateSession(new NextRequest("https://monitor.test/dashboard"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://monitor.test/login");
  assert.equal(response.cookies.get("test-session")?.maxAge, 0);
  assert.equal(response.cookies.get("test-second")?.maxAge, 0);
});
