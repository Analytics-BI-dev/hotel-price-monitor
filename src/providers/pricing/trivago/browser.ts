import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Browser, LaunchOptions } from "playwright-core";
import { browserFailureFacts } from "./browser-diagnostics.ts";

type BrowserEnvironment = {
  VERCEL?: string;
  VERCEL_ENV?: string;
};

type BrowserDependencies = {
  preparePlaywright?: () => Promise<string>;
  launch: (options: LaunchOptions) => Promise<Browser>;
  serverless: () => Promise<{ args: string[]; executablePath: () => Promise<string> }>;
};

export class TrivagoBrowserError extends Error {
  readonly category: "browser_not_installed" | "browser_launch_error";

  constructor(category: "browser_not_installed" | "browser_launch_error") {
    super(category === "browser_not_installed"
      ? "Chromium ausente: confira o pacote serverless no deploy ou instale o navegador no ambiente local."
      : "Não foi possível iniciar o Chromium. Confira runtime, arquitetura e memória da função.");
    this.name = "TrivagoBrowserError";
    this.category = category;
  }
}

export function usesServerlessChromium(environment: BrowserEnvironment): boolean {
  return environment.VERCEL === "1" && environment.VERCEL_ENV !== "development";
}

// Only the binary path is reused. Browsers, contexts and cookies remain isolated.
// Serializing extraction prevents simultaneous cold starts inside one process
// from attempting to decompress the same files in /tmp.
export function createTrivagoBrowserLauncher(dependencies: BrowserDependencies) {
  let executable: Promise<string> | undefined;

  return async (environment: BrowserEnvironment = {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  }): Promise<Browser> => {
    const startedAt = performance.now();
    const browserLaunchId = randomUUID();
    const serverless = usesServerlessChromium(environment);
    let stage = "load_playwright";
    let executableExists: boolean | null = null;
    const context = {
      source: "trivago",
      browserLaunchId,
      browserRuntime: serverless ? "serverless" : "local",
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    };
    console.info(JSON.stringify({ event: "TRIVAGO_BROWSER_START", ...context, stage }));
    try {
      // Separate module loading from OS process launch in the diagnostic.
      const localExecutable = await dependencies.preparePlaywright?.();
      const options: LaunchOptions = { headless: true, timeout: 30_000 };
      if (serverless) {
        stage = "load_serverless_module";
        const chromium = await dependencies.serverless();
        stage = "extract_executable";
        executable ??= chromium.executablePath().catch((error: unknown) => {
          executable = undefined;
          throw error;
        });
        options.executablePath = await executable;
        stage = "configure_arguments";
        // Keep serverless process flags, but do not disable web security or
        // permit mixed content just to collect public hotel pages.
        options.args = chromium.args.filter((argument) => ![
          "--disable-web-security",
          "--allow-running-insecure-content",
          "--disable-site-isolation-trials",
        ].includes(argument));
      }
      stage = "inspect_executable";
      const executablePath = options.executablePath ?? localExecutable;
      // Runtime-only path (e.g. /tmp/chromium); bin assets are explicitly traced
      // in next.config.ts. Do not trace the project for this diagnostic probe.
      executableExists = executablePath ? existsSync(/* turbopackIgnore: true */ executablePath) : null;
      stage = "launch_browser";
      const browser = await dependencies.launch(options);
      console.info(JSON.stringify({
        event: "TRIVAGO_BROWSER_READY", ...context, stage, executableExists,
        durationMs: Math.round(performance.now() - startedAt),
      }));
      return browser;
    } catch (error) {
      // Never propagate Chromium's raw launch output (paths, flags or page data).
      const message = error instanceof Error ? error.message : "";
      const missing = /executable doesn't exist|input directory.*does not exist|ENOENT.*chromium/i.test(message);
      console.error(JSON.stringify({
        event: "TRIVAGO_BROWSER_ERROR", ...context, stage, executableExists,
        durationMs: Math.round(performance.now() - startedAt),
        ...browserFailureFacts(error),
      }));
      throw new TrivagoBrowserError(missing ? "browser_not_installed" : "browser_launch_error");
    }
  };
}

export const launchTrivagoBrowser = createTrivagoBrowserLauncher({
  preparePlaywright: async () => (await import("playwright-core")).chromium.executablePath(),
  launch: async (options) => {
    const { chromium } = await import("playwright-core");
    return chromium.launch(options);
  },
  serverless: async () => (await import("@sparticuz/chromium")).default,
});
