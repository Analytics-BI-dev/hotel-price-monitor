import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Recreate ONLY the dependencies listed by the dashboard's production trace,
// outside the repo, so local node_modules cannot hide missing deployment files.
const root = fileURLToPath(new URL("../", import.meta.url));
const tracePath = path.join(root, ".next/server/app/dashboard/page.js.nft.json");
assert.ok(existsSync(tracePath), "Execute npm run build primeiro.");
const { files } = JSON.parse(readFileSync(tracePath, "utf8"));
const tempRoot = realpathSync(tmpdir());
const sandbox = mkdtempSync(path.join(tempRoot, "hotel-trivago-bundle-"));
const dependencies = path.join(root, "node_modules");
let bytes = 0;
let copied = 0;

try {
  for (const file of files) {
    const source = path.resolve(path.dirname(tracePath), file);
    const relative = path.relative(dependencies, source);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const target = path.join(sandbox, "node_modules", relative);
    if (!statSync(source).isFile()) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    bytes += statSync(source).size;
    copied++;
  }
  for (const asset of ["chromium.br", "al2023.tar.br", "fonts.tar.br", "swiftshader.tar.br"]) {
    assert.ok(existsSync(path.join(sandbox, "node_modules/@sparticuz/chromium/bin", asset)), `Binário ausente no trace: ${asset}`);
  }
  const childCode = `
    import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    const require = createRequire(pathToFileURL(path.join(process.cwd(), "probe.cjs")));
    let stage = "require_playwright_core";
    try {
      assert.ok(require.resolve("playwright-core").startsWith(process.cwd() + path.sep));
      const cjs = require("playwright-core");
      assert.equal(typeof cjs.chromium.launch, "function");
      assert.equal(typeof cjs.chromium.executablePath(), "string");
      stage = "import_playwright_core";
      const esm = await import("playwright-core");
      assert.equal(esm.chromium, cjs.chromium);
      stage = "import_serverless_chromium";
      const chromium = (await import("@sparticuz/chromium")).default;
      assert.equal(typeof chromium.executablePath, "function");
      assert.ok(Array.isArray(chromium.args));
      console.log(JSON.stringify({ event: "TRIVAGO_BUNDLE_IMPORT_SUCCESS", coreVersion: require("playwright-core/package.json").version }));
    } catch (error) {
      const codes = ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_REQUIRE_ASYNC_MODULE", "ERR_REQUIRE_ESM", "ERR_ASSERTION"];
      console.log(JSON.stringify({ event: "TRIVAGO_BUNDLE_IMPORT_ERROR", stage, errorCode: codes.includes(error.code) ? error.code : "other" }));
      process.exitCode = 1;
    }
  `;
  // No Supabase env, NODE_PATH or NODE_OPTIONS are inherited by the probe.
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"].flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));
  try {
    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", childCode], {
      cwd: sandbox, env, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(output);
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string") process.stdout.write(error.stdout);
    throw new Error("Falha ao importar dependências isoladas do deployment.");
  }
  console.info(JSON.stringify({ event: "TRIVAGO_BUNDLE_CHECK_SUCCESS", dependencyFiles: copied, dependencyMiB: Math.round(bytes / 1024 / 1024) }));
} finally {
  // Delete only this run's generated temp directory, never the repo or node_modules.
  assert.equal(path.dirname(realpathSync(sandbox)), tempRoot);
  assert.ok(path.basename(sandbox).startsWith("hotel-trivago-bundle-"));
  rmSync(sandbox, { recursive: true, force: true });
}
