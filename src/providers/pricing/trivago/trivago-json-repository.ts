import "server-only";

import { z } from "zod";

// Extra columns are intentionally not validated or used to fill missing prices.
export interface TrivagoJsonRecord {
  Hotel: string;
  Data: string;
  hospedes: number;
  Site: unknown;
  Execucao: string;
  Preco_Num: unknown;
  "Descrição"?: unknown;
  "Preço"?: unknown;
  Vantagens?: unknown;
  Turno?: unknown;
  Preco_Min?: unknown;
  Comparado_Com?: unknown;
  Preco_Anterior?: unknown;
  Delta?: unknown;
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseTrivagoData(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  return validCalendarDate(Number(year), Number(month), Number(day))
    ? `${year}-${month}-${day}` : null;
}

// No timezone is supplied. Compare validated, fixed-width wall-clock values
// from the same producer; never reinterpret them in the server's timezone.
export function parseTrivagoExecution(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return validCalendarDate(year, month, day) && hour < 24 && minute < 60 && second < 60
    ? value : null;
}

const recordSchema = z.object({
  Hotel: z.string().min(1),
  Data: z.string().refine((value) => parseTrivagoData(value) !== null),
  hospedes: z.number().int().positive(),
  Execucao: z.string().refine((value) => parseTrivagoExecution(value) !== null),
  Site: z.unknown(),
  Preco_Num: z.unknown(),
});

export interface TrivagoSnapshot {
  execution: string;
  offers: { providerName: string; price: number }[];
}

type ErrorCategory = "missing_url" | "invalid_url" | "timeout" | "http_error" |
  "html_response" | "invalid_json" | "invalid_root" | "incompatible_schema" | "fetch_failed";

export class TrivagoJsonError extends Error {
  readonly category: ErrorCategory;
  constructor(category: ErrorCategory, message: string) {
    super(message);
    this.name = "TrivagoJsonError";
    this.category = category;
  }
}

function key(hotel: string, date: string, adults: number): string {
  return JSON.stringify([hotel, date, adults]);
}

export function indexTrivagoJson(value: unknown): ReadonlyMap<string, TrivagoSnapshot> {
  if (!Array.isArray(value)) {
    throw new TrivagoJsonError("invalid_root", "A raiz do JSON Trivago precisa ser um array.");
  }
  const index = new Map<string, TrivagoSnapshot>();
  let recognized = 0;
  let invalid = 0;
  for (const raw of value) {
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success || !Object.hasOwn(raw, "Site") || !Object.hasOwn(raw, "Preco_Num")) {
      invalid++;
      continue;
    }
    recognized++;
    const row = parsed.data;
    const date = parseTrivagoData(row.Data)!;
    const lookupKey = key(row.Hotel, date, row.hospedes);
    const previous = index.get(lookupKey);
    // Select recency BEFORE validating the offer: an empty latest snapshot
    // must never resurrect a valid offer from yesterday's execution.
    if (!previous || row.Execucao > previous.execution) {
      index.set(lookupKey, { execution: row.Execucao, offers: [] });
    }
    const site = typeof row.Site === "string" ? row.Site.trim() : "";
    if (!site || typeof row.Preco_Num !== "number" || !Number.isFinite(row.Preco_Num) || row.Preco_Num <= 0) {
      invalid++;
      continue;
    }
    const snapshot = index.get(lookupKey)!;
    if (row.Execucao === snapshot.execution) {
      snapshot.offers.push({ providerName: site, price: row.Preco_Num });
    }
  }
  if (invalid) console.warn(JSON.stringify({ event: "TRIVAGO_JSON_INVALID_RECORDS", count: invalid }));
  if (value.length > 0 && recognized === 0) {
    throw new TrivagoJsonError("incompatible_schema", "Nenhum registro possui o schema esperado do JSON Trivago.");
  }
  for (const snapshot of index.values()) snapshot.offers.sort((a, b) => a.price - b.price);
  return index;
}

export interface TrivagoJsonRepositoryOptions {
  url?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

// One instance belongs to ONE dashboard search. Share the promise (including
// failures) across all hotels/days; never keep this repository in a singleton.
export class TrivagoJsonRepository {
  private readonly options: TrivagoJsonRepositoryOptions;
  private pending?: Promise<ReadonlyMap<string, TrivagoSnapshot>>;

  constructor(options: TrivagoJsonRepositoryOptions = {}) {
    this.options = options;
  }

  async lookup(hotel: string, date: string, adults: number): Promise<TrivagoSnapshot | undefined> {
    this.pending ??= this.download();
    return (await this.pending).get(key(hotel, date, adults));
  }

  private async download(): Promise<ReadonlyMap<string, TrivagoSnapshot>> {
    const startedAt = performance.now();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    console.info(JSON.stringify({ event: "TRIVAGO_JSON_FETCH_START" }));
    try {
      const configuredUrl = this.options.url ?? process.env.TRIVAGO_JSON_URL;
      if (!configuredUrl?.trim()) {
        throw new TrivagoJsonError("missing_url", "TRIVAGO_JSON_URL não configurada no servidor.");
      }
      let url: URL;
      try {
        url = new URL(configuredUrl);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new TrivagoJsonError("invalid_url", "TRIVAGO_JSON_URL precisa ser uma URL HTTP(S) de conteúdo JSON direto.");
      }
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new TrivagoJsonError("timeout", "Tempo limite excedido ao baixar o JSON Trivago."));
          controller.abort();
        }, this.options.timeoutMs ?? 15_000);
      });
      const download = async () => {
        const response = await (this.options.fetcher ?? fetch)(url, {
          cache: "no-store",
          redirect: "follow",
          signal: controller.signal,
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        });
        if (!response.ok) {
          throw new TrivagoJsonError("http_error", `Falha HTTP ${response.status} ao baixar o JSON Trivago.`);
        }
        const body = (await response.text()).replace(/^\uFEFF/, "");
        if (/text\/html|application\/xhtml/i.test(response.headers.get("content-type") ?? "") || /^\s*</.test(body)) {
          throw new TrivagoJsonError("html_response", "TRIVAGO_JSON_URL retornou HTML. Configure uma URL de download/conteúdo JSON direto, não a página de compartilhamento do OneDrive.");
        }
        let data: unknown;
        try { data = JSON.parse(body); } catch {
          throw new TrivagoJsonError("invalid_json", "O arquivo Trivago não contém JSON válido.");
        }
        const index = indexTrivagoJson(data);
        return { index, records: (data as unknown[]).length };
      };
      const { index, records } = await Promise.race([download(), timeout]);
      console.info(JSON.stringify({ event: "TRIVAGO_JSON_FETCH_SUCCESS", records, durationMs: Math.round(performance.now() - startedAt) }));
      return index;
    } catch (error) {
      // Raw network errors may contain signed URLs. Only our fixed messages
      // and categories are logged; nothing from the response body is exposed.
      const safeError = error instanceof TrivagoJsonError ? error :
        new TrivagoJsonError("fetch_failed", "Não foi possível baixar o JSON Trivago.");
      console.error(JSON.stringify({ event: "TRIVAGO_JSON_ERROR", category: safeError.category, message: safeError.message }));
      throw safeError;
    } finally {
      clearTimeout(timer);
    }
  }
}
