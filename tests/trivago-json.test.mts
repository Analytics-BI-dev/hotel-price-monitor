import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { TrivagoJsonPricingProvider } from "../src/providers/pricing/trivago/trivago-json-provider.ts";
import { TrivagoJsonRepository, indexTrivagoJson, parseTrivagoData, parseTrivagoExecution } from "../src/providers/pricing/trivago/trivago-json-repository.ts";
import { buildTrivagoSearchUrl, trivagoHotelConfigs } from "../src/providers/pricing/trivago/hotel-configs.ts";
import type { PricingHotel, ValidatedPricingSearch } from "../src/types/pricing.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/trivago-daily.json", import.meta.url), "utf8"));
const params: ValidatedPricingSearch = { checkIn: "2026-09-11", checkOut: "2026-09-12", adults: 2, nights: 1, rooms: 1, children: 0 };
const config = trivagoHotelConfigs[0];
const hotel: PricingHotel = { id: "curi", slug: config.hotelSlug, name: config.hotelName, is_reference_hotel: true, official_site_enabled: true, official_site_url: null, trivago_enabled: true, trivago_property_id: config.propertyId };
const row = { Hotel: config.hotelName, Data: "11-09-2026", hospedes: 2, Site: "Agoda", Preco_Num: 320, Execucao: "2026-09-10 19:40:36" };

function repository(data: unknown = fixture) {
  return new TrivagoJsonRepository({ url: "https://fixture.invalid/daily.json", fetcher: async () => Response.json(data) });
}
async function result(data: unknown = fixture, input = params) {
  return (await new TrivagoJsonPricingProvider(config, repository(data)).search(input, hotel))[0].result;
}

test("Data é DD-MM-YYYY com calendário válido, inclusive anos bissextos", () => {
  assert.equal(parseTrivagoData("10-09-2026"), "2026-09-10");
  assert.equal(parseTrivagoData("29-02-2024"), "2024-02-29");
  for (const value of ["29-02-2026", "31-04-2026", "00-09-2026", "10-13-2026", "2026-09-10", "1-9-2026", "01-01-0000"]) assert.equal(parseTrivagoData(value), null);
});

test("Execucao valida explicitamente calendário e hora, sem depender de timezone", () => {
  assert.equal(parseTrivagoExecution(row.Execucao), row.Execucao);
  for (const value of ["2026-02-29 19:40:36", "2026-09-10 24:00:00", "2026-09-10 19:60:00", "2026-09-10 19:40:60", "2026-09-10T19:40:36Z", "invalid"]) assert.equal(parseTrivagoExecution(value), null);
});

test("filtra hotel/data/2 adultos e usa somente a execução mais recente, ordenada", async () => {
  const actual = await result();
  assert.equal(actual.status, "success");
  assert.equal(actual.bestPrice, 289);
  assert.equal(actual.bestProvider, "HRS.com");
  assert.deepEqual(actual.offers.map((offer) => [offer.providerName, offer.price]), [["HRS.com", 289], ["Hoteis.com", 296], ["Booking.com", 299], ["Expedia", 306]]);
  assert.ok(actual.offers.every((offer) => offer.source === "trivago" && offer.currency === "BRL" && offer.roomName === null));
});

test("1 adulto nunca recebe ofertas de 2 adultos", async () => {
  assert.equal((await result(fixture, { ...params, adults: 1 })).bestPrice, 210);
});

test("empates preservam todas as ofertas e a ordem original; ignora Preco_Min", async () => {
  const actual = await result([{ ...row, Preco_Min: 1 }, { ...row, Site: "Booking.com" }]);
  assert.equal(actual.bestPrice, 320);
  assert.equal(actual.bestProvider, "Agoda");
  assert.deepEqual(actual.offers.map((offer) => offer.providerName), ["Agoda", "Booking.com"]);
  assert.equal(new Set(actual.offers.map((offer) => offer.id)).size, 2);
});

test("M Tower mantém empate e escolhe primeira oferta mínima", async () => {
  const tower = trivagoHotelConfigs[6];
  const [day] = await new TrivagoJsonPricingProvider(tower, repository()).search(params, { ...hotel, slug: tower.hotelSlug });
  assert.equal(day.result.bestPrice, 382);
  assert.equal(day.result.bestProvider, "Hoteis.com");
  assert.deepEqual(day.result.offers.map((offer) => offer.price), [382, 382, 386, 420]);
});

test("snapshot novo sem ofertas válidas não ressuscita preços antigos, em qualquer ordem", async () => {
  const latest = { ...row, Site: "", Execucao: "2026-09-11 01:00:00", Turno: "manhã" };
  for (const rows of [[row, latest], [latest, row]]) {
    const actual = await result(rows);
    assert.equal(actual.status, "unavailable");
    assert.equal(actual.bestPrice, null);
    assert.equal(actual.bestProvider, null);
    assert.deepEqual(actual.offers, []);
  }
});

test("ignora Site vazio/null e Preco_Num não numérico, não finito ou não positivo", async () => {
  const invalid = [
    ...["", "  ", null, 123].map((Site) => ({ ...row, Site })),
    ...[null, 0, -1, "320", "inválido", Infinity, NaN].map((Preco_Num) => ({ ...row, Preco_Num })),
  ];
  assert.equal((await result(invalid)).status, "unavailable");
  assert.equal((await result([...invalid, row])).offers.length, 1);
});

test("sem hotel, data ou ocupação retorna unavailable sem preencher pelo histórico", async () => {
  for (const data of [[], [{ ...row, Hotel: "hotel curi executive" }], [{ ...row, Data: "12-09-2026" }], [{ ...row, hospedes: 1 }], [{ ...row, Preco_Num: null, Preco_Anterior: 50, Delta: 10, Comparado_Com: "ontem" }]]) {
    const actual = await result(data);
    assert.equal(actual.status, "unavailable");
    assert.equal(actual.bestPrice, null);
    assert.equal(actual.bestProvider, null);
    assert.deepEqual(actual.offers, []);
    assert.ok(actual.searchUrl);
  }
});

test("linhas defeituosas são contadas sem invalidar linhas boas; extras são tolerados", async (t) => {
  const warning = t.mock.method(console, "warn", () => undefined);
  assert.equal((await result([null, { ...row, Data: "31-02-2026" }, { ...row, Execucao: "errada" }, { ...row, hospedes: "2" }, { ...row, "Descrição": "", Vantagens: [], Delta: null, Preco_Anterior: null }])).bestPrice, 320);
  assert.deepEqual(JSON.parse(warning.mock.calls[0].arguments[0]), { event: "TRIVAGO_JSON_INVALID_RECORDS", count: 4 });
});

test("schema completamente incompatível e raiz não array são erros", async () => {
  for (const data of [{}, null, [null, 1, "x", {}], [{ wrong: "schema" }]]) {
    assert.throws(() => indexTrivagoJson(data));
    assert.equal((await result(data)).status, "error");
  }
});

test("URL manual preserva todos os property IDs, datas e ocupação", () => {
  assert.deepEqual(trivagoHotelConfigs.map((item) => item.propertyId), ["2436946", "1180090", "7770070", "3387958", "3487706", "48115946", "2899803"]);
  for (const item of trivagoHotelConfigs) for (const adults of [1, 2]) {
    const url = new URL(buildTrivagoSearchUrl({ ...params, adults }, item));
    assert.equal(url.hostname, "www.trivago.com.br");
    assert.equal(url.pathname, `/pt-BR/lm/${item.searchPathSlug}`);
    assert.equal(url.searchParams.get("search"), `100-${item.propertyId};dr-20260911-20260912;drs-40;rc-1-${adults}`);
  }
});

test("falhas HTTP, HTML, JSON malformado e rede retornam error sem vazar URL", async (t) => {
  const logs = t.mock.method(console, "error", () => undefined);
  const cases: [typeof fetch, string][] = [
    [async () => new Response("erro", { status: 503 }), "http_error"],
    [async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }), "html_response"],
    [async () => new Response(" <!doctype html>"), "html_response"],
    [async () => new Response("{broken"), "invalid_json"],
    [async () => { throw new Error("https://secret.invalid/?token=DO_NOT_LOG"); }, "fetch_failed"],
  ];
  for (const [fetcher, category] of cases) {
    const repo = new TrivagoJsonRepository({ url: "https://secret.invalid/?token=DO_NOT_LOG", fetcher });
    const [day] = await new TrivagoJsonPricingProvider(config, repo).search(params, hotel);
    assert.equal(day.result.status, "error");
    assert.ok(day.result.searchUrl);
    assert.deepEqual(day.result.offers, []);
    assert.equal(JSON.parse(logs.mock.calls.at(-1)!.arguments[0]).category, category);
  }
  assert.equal(JSON.stringify(logs.mock.calls).includes("DO_NOT_LOG"), false);
  assert.match(JSON.parse(logs.mock.calls[1].arguments[0]).message, /conteúdo JSON direto/);
});

test("URL ausente ou inválida não inicia download", async (t) => {
  t.mock.method(console, "error", () => undefined);
  for (const url of ["", "not a url", "file:///private.json"]) {
    let downloads = 0;
    const repo = new TrivagoJsonRepository({ url, fetcher: async () => { downloads++; return Response.json([]); } });
    assert.equal((await new TrivagoJsonPricingProvider(config, repo).search(params, hotel))[0].result.status, "error");
    assert.equal(downloads, 0);
  }
});

test("timeout limita tanto resposta quanto leitura do corpo e cancela download", async () => {
  for (const bodyStalls of [false, true]) {
    let signal: AbortSignal | undefined;
    const repo = new TrivagoJsonRepository({ url: "https://fixture.invalid/", timeoutMs: 10, fetcher: async (_, init) => {
      signal = init?.signal as AbortSignal;
      if (!bodyStalls) return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start() {} }));
    } });
    assert.equal((await new TrivagoJsonPricingProvider(config, repo).search(params, hotel))[0].result.status, "error");
    assert.equal(signal?.aborted, true);
  }
});

test("falha compartilhada faz somente uma tentativa por pesquisa", async () => {
  let downloads = 0;
  const repo = new TrivagoJsonRepository({ url: "https://fixture.invalid/", fetcher: async () => { downloads++; return new Response(null, { status: 500 }); } });
  const provider = new TrivagoJsonPricingProvider(config, repo);
  await Promise.all([provider.search({ ...params, nights: 10 }, hotel), provider.search(params, hotel)]);
  await provider.search(params, hotel);
  assert.equal(downloads, 1);
});

test("segue redirect HTTP real e aceita conteúdo JSON direto sem MIME application/json", async (t) => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);
    if (req.url === "/share") { res.writeHead(302, { Location: "/content" }); res.end(); }
    else { res.writeHead(200, { "Content-Type": "application/octet-stream" }); res.end(JSON.stringify(fixture)); }
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const repo = new TrivagoJsonRepository({ url: `http://127.0.0.1:${address.port}/share` });
  const [day] = await new TrivagoJsonPricingProvider(config, repo).search(params, hotel);
  assert.equal(day.result.bestPrice, 289);
  assert.deepEqual(requests, ["/share", "/content"]);
});
