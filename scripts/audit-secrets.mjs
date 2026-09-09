import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const secretName = /SECRET|PASSWORD|TOKEN|PRIVATE_KEY|AUTHORIZATION|COOKIE/i;
const knownSecrets = new Set();

function rememberSecrets(environment) {
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith("NEXT_PUBLIC_") && secretName.test(name) && typeof value === "string" && value.length >= 6) {
      knownSecrets.add(value);
    }
  }
}

function walk(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filename, files);
    else if (entry.isFile()) files.add(path.relative(projectRoot, filename));
  }
}

function main() {
  // Configured secret values stay in memory and are never included in output.
  rememberSecrets(process.env);
  for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^\.env(?:\.|$)/.test(entry.name) && entry.name !== ".env.example") {
      rememberSecrets(parseEnv(readFileSync(path.join(projectRoot, entry.name), "utf8")));
    }
  }

  const gitFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).split("\0").filter(Boolean);
  const files = new Set(gitFiles);
  const staticDirectory = path.join(projectRoot, ".next", "static");
  const staticExists = existsSync(staticDirectory);
  if (staticExists) walk(staticDirectory, files);

  const patterns = [
    ["supabase-secret-key", /\bsb_secret_[A-Za-z0-9_-]{16,}/],
    ["jwt-token", /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["authorization-literal", /\b(?:Bearer|Basic) [A-Za-z0-9+/_=-]{24,}/],
  ];
  let findings = 0;
  let scannedFiles = 0;
  const report = (file, type) => {
    findings++;
    console.error(JSON.stringify({ event: "SECRET_AUDIT_FINDING", file, type }));
  };

  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    const basename = path.basename(file);
    if ((/^\.env(?:\.|$)/.test(basename) && basename !== ".env.example") ||
        /(?:^|\/)(?:\.playwright-state|playwright\/\.auth|playwright-report|test-results|blob-report)(?:\/|$)/.test(normalized) ||
        /(?:storageState|storage-state).*\.json$|\.har$|\.trace\.zip$|\.(?:pem|key)$/.test(basename)) {
      report(normalized, "sensitive-artifact-in-git-candidates");
      continue; // Do not read browser states or private key files, even if tracked.
    }
    const filename = path.join(projectRoot, file);
    if (!existsSync(filename) || !lstatSync(filename).isFile()) continue;
    const content = readFileSync(filename, "utf8");
    scannedFiles++;
    if ([...knownSecrets].some((secret) => content.includes(secret))) {
      report(normalized, "configured-secret-value");
    }
    for (const [type, pattern] of patterns) {
      if (pattern.test(content)) report(normalized, type);
    }
  }
  console.log(JSON.stringify({
    event: "SECRET_AUDIT_COMPLETE", scannedFiles, configuredSecrets: knownSecrets.size,
    clientBuildScanned: staticExists, findings,
  }));
  if (findings > 0) process.exitCode = 1;
}

try {
  main();
} catch {
  console.error("SECRET_AUDIT_FAILED: não foi possível concluir a leitura dos arquivos locais.");
  process.exitCode = 1;
}
