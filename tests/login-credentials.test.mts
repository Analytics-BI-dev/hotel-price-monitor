import assert from "node:assert/strict";
import test from "node:test";

import { readLoginCredentials } from "../src/lib/auth/login-credentials.ts";

test("preserva a senha exatamente como foi digitada", () => {
  const formData = new FormData();
  const password = "  Senha Com Espaços 123!  ";

  formData.set("email", "  admin@analyticsbi.com.br  ");
  formData.set("password", password);

  const credentials = readLoginCredentials(formData);

  assert.equal(credentials.email, "admin@analyticsbi.com.br");
  assert.equal(credentials.password, password);
  assert.equal(credentials.password.length, password.length);
});

test("usa somente os campos email e password esperados pelo formulário", () => {
  const formData = new FormData();

  formData.set("username", "campo-incorreto@example.com");
  formData.set("email", "admin@analyticsbi.com.br");
  formData.set("password", "senha-de-teste");

  assert.deepEqual(readLoginCredentials(formData), {
    email: "admin@analyticsbi.com.br",
    password: "senha-de-teste",
  });
});
