import "server-only";

import type { Browser, LaunchOptions } from "playwright";

type BrowserEnvironment = {
  VERCEL?: string;
  VERCEL_ENV?: string;
};

type BrowserDependencies = {
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
    try {
      const options: LaunchOptions = { headless: true, timeout: 30_000 };
      if (usesServerlessChromium(environment)) {
        const chromium = await dependencies.serverless();
        executable ??= chromium.executablePath().catch((error: unknown) => {
          executable = undefined;
          throw error;
        });
        options.executablePath = await executable;
        // Keep serverless process flags, but do not disable web security or
        // permit mixed content just to collect public hotel pages.
        options.args = chromium.args.filter((argument) => ![
          "--disable-web-security",
          "--allow-running-insecure-content",
          "--disable-site-isolation-trials",
        ].includes(argument));
      }
      return await dependencies.launch(options);
    } catch (error) {
      // Never propagate Chromium's raw launch output (paths, flags or page data).
      const message = error instanceof Error ? error.message : "";
      const missing = /executable doesn't exist|input directory.*does not exist|ENOENT.*chromium/i.test(message);
      throw new TrivagoBrowserError(missing ? "browser_not_installed" : "browser_launch_error");
    }
  };
}

export const launchTrivagoBrowser = createTrivagoBrowserLauncher({
  launch: async (options) => {
    const { chromium } = await import("playwright");
    return chromium.launch(options);
  },
  serverless: async () => (await import("@sparticuz/chromium")).default,
});
