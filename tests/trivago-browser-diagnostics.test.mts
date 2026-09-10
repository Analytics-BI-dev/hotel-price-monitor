import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright";
import { browserFailureFacts } from "../src/providers/pricing/trivago/browser-diagnostics.ts";
import { createTrivagoBrowserLauncher, TrivagoBrowserError } from "../src/providers/pricing/trivago/browser.ts";

test("diagnóstico distingue motivos técnicos sem copiar mensagem, stack ou propriedades extras", () => {
  const cases = [
    ["ERR_REQUIRE_ASYNC_MODULE", "require() cannot be used on an ESM graph with top-level await", "async_module_require"],
    ["ERR_REQUIRE_ESM", "ES Module", "esm_require_incompatible"],
    ["ERR_MODULE_NOT_FOUND", "Cannot find package @sparticuz/chromium", "module_not_found"],
    ["EACCES", "permission denied", "permission_denied"],
    ["ENOEXEC", "Exec format error", "executable_format_incompatible"],
    ["ENOSPC", "disk", "temporary_storage_full"],
    ["ENOMEM", "memory", "memory_allocation_failed"],
    ["Z_DATA_ERROR", "decompress", "binary_decompression_failed"],
    ["", "error while loading shared libraries: libnss3.so: cannot open shared object file", "shared_library_missing"],
    ["", "GLIBC_2.38 not found", "libc_version_incompatible"],
    ["", "exitCode=null signal=SIGKILL", "process_killed"],
    ["", "Target page, context or browser has been closed; exitCode=127", "browser_closed_during_launch"],
    ["", "unrecognized error", "unclassified_browser_error"],
  ];
  for (const [code, message, reason] of cases) {
    const secret = "synthetic-private-value";
    const error = Object.assign(new Error(`${message}; password=${secret}; Authorization: Bearer ${secret}; https://example.test/?token=${secret}`), {
      code, cookie: secret, SUPABASE_SECRET_KEY: secret,
    });
    const facts = browserFailureFacts(error);
    assert.equal(facts.reason, reason);
    assert.doesNotMatch(JSON.stringify(facts), /synthetic-private-value|Authorization|password|cookie|SUPABASE|example\.test/);
  }
  assert.equal(browserFailureFacts(new Error("error while loading shared libraries: libnss3.so: cannot open shared object file")).missingLibrary, "libnss3.so");
  assert.equal(browserFailureFacts(new Error("exitCode=127")).exitCode, 127);
  assert.equal(browserFailureFacts(new Error("exitCode=999")).exitCode, null);
  assert.equal(browserFailureFacts("private arbitrary string").reason, "unclassified_browser_error");
  assert.equal(browserFailureFacts(new Error("wrapper", { cause: Object.assign(new Error("module"), { code: "ERR_REQUIRE_ASYNC_MODULE" }) })).reason, "async_module_require");
});

for (const failedStage of ["load_playwright", "load_serverless_module", "extract_executable", "launch_browser"]) {
  test(`registra etapa ${failedStage} e contexto seguro mantendo erro amigável`, async (t) => {
    const logs: string[] = [];
    t.mock.method(console, "info", (value: string) => logs.push(value));
    t.mock.method(console, "error", (value: string) => logs.push(value));
    const fail = () => { throw Object.assign(new Error("synthetic-sensitive-launch-output"), { code: "EACCES" }); };
    const launch = createTrivagoBrowserLauncher({
      preparePlaywright: async () => failedStage === "load_playwright" ? fail() : process.execPath,
      serverless: async () => failedStage === "load_serverless_module" ? fail() : {
        args: [],
        executablePath: async () => failedStage === "extract_executable" ? fail() : process.execPath,
      },
      launch: async () => fail(),
    });
    await assert.rejects(launch({ VERCEL: "1", VERCEL_ENV: "production" }), TrivagoBrowserError);
    const failure = JSON.parse(logs.find((line) => line.includes("TRIVAGO_BROWSER_ERROR"))!);
    assert.equal(failure.stage, failedStage);
    assert.equal(failure.reason, "permission_denied");
    assert.equal(failure.errorCode, "EACCES");
    assert.equal(failure.nodeVersion, process.version);
    assert.equal(failure.platform, process.platform);
    assert.equal(failure.architecture, process.arch);
    assert.equal(failure.browserRuntime, "serverless");
    assert.equal(failure.executableExists, failedStage === "launch_browser" ? true : null);
    assert.equal(failure.browserLaunchId, JSON.parse(logs[0]).browserLaunchId);
    assert.doesNotMatch(logs.join("\n"), /synthetic-sensitive-launch-output/);
    assert.equal(logs.some((line) => line.includes("TRIVAGO_BROWSER_READY")), false);
  });
}

test("READY só aparece após abertura e existência do executável é observacional", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "info", (value: string) => logs.push(value));
  const browser = {} as Browser;
  const launch = createTrivagoBrowserLauncher({
    preparePlaywright: async () => process.execPath,
    serverless: async () => { throw new Error("não carrega no local"); },
    launch: async () => { assert.equal(logs.length, 1); return browser; },
  });
  assert.equal(await launch({}), browser);
  const ready = JSON.parse(logs[1]);
  assert.equal(ready.event, "TRIVAGO_BROWSER_READY");
  assert.equal(ready.executableExists, true);
  assert.equal(ready.browserRuntime, "local");
  assert.ok(ready.durationMs >= 0);
});
