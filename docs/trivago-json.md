# Trivago: fonte JSON diária

## Fluxo e isolamento

`searchPricesAction` → `searchPricing` → registry → `HybridPricingProvider`.
O registry preserva as instâncias dos providers oficiais e cria um
`TrivagoJsonRepository` por chamada de `search`. As sete instâncias de
`TrivagoJsonPricingProvider` compartilham esse repositório. O download inicia
na primeira consulta e sua Promise, inclusive em caso de falha, é reutilizada
até o fim daquela busca. Não há estado global, cache persistente ou retry.
Buscas simultâneas, mesmo idênticas, possuem seus próprios repositórios.

O download usa fetch HTTP(S), `cache: "no-store"`, `redirect: "follow"`,
`Cache-Control: no-cache` e um prazo total de 15 segundos, incluindo leitura
do corpo. Um redirect pode envolver mais de uma requisição HTTP, mas há somente
um carregamento do arquivo por busca, inclusive para 70 resultados diários.
O corpo é interpretado e indexado uma vez. Novas pesquisas leem novamente a
origem; substituir o arquivo na mesma URL não exige restart/rebuild/redeploy.

## Configuração e privacidade

Configure `TRIVAGO_JSON_URL` no `.env.local` e no servidor de produção.
O `.env.example` contém apenas a chave vazia. Os módulos usam `server-only`.
A URL nunca integra `SourceResult`, o bundle cliente ou os logs.

A URL deve retornar o conteúdo JSON diretamente, sem autenticação interativa.
Links que respondam com redirect para o conteúdo são aceitos. Resposta HTML
(pelo MIME ou pelo início do corpo) gera `html_response`, com instrução clara
no servidor para usar uma URL de download/conteúdo direto. Não se extrai JSON
de HTML e não há Microsoft Graph, cookies ou credenciais Microsoft.
MIME genérico, como `application/octet-stream`, é aceito se o corpo for JSON.

## Contrato e snapshots

A raiz é um array. Os campos reconhecidos são `Hotel`, `Data`, `hospedes`,
`Site`, `Execucao` e `Preco_Num`. Zod valida a identidade e o calendário;
campos extras como `Descrição`, `Preço`, `Vantagens`, `Turno`, `Preco_Min`,
`Comparado_Com`, `Preco_Anterior` e `Delta` não interferem na seleção.

- `Data`: parser explícito DD-MM-YYYY → YYYY-MM-DD, com validação de calendário
  e ano bissexto. Não usa interpretação automática de strings por Date.
- `Execucao`: valida YYYY-MM-DD HH:mm:ss e compara valores de largura fixa.
  Sem fuso no arquivo, preserva a hora do produtor e não a converte para o fuso
  do servidor. Espera-se que todas as execuções usem a mesma convenção de hora.
- `hospedes`: número inteiro positivo; a consulta exige igualdade exata com
  adults (1 ou 2), sem coerção de strings e sem misturar ocupações.
- Hotel: igualdade exata com o nome centralizado em `hotel-configs.ts`.

| Slug | Hotel no JSON | Property ID para link manual |
| --- | --- | ---: |
| hotel-curi-executive | Hotel Curi Executive | 2436946 |
| curi-palace-hotel | Curi Palace Hotel | 1180090 |
| hotel-alles-blau | Hotel Alles Blau | 7770070 |
| jacques-georges-tower | Jacques Georges Tower | 3387958 |
| jacques-georges-business | Hotel Jacques Georges Business | 3487706 |
| ibis-pelotas | ibis Pelotas | 48115946 |
| m-tower-hotel | M Tower Hotel | 2899803 |

Para cada Hotel + Data + hospedes, o índice mantém apenas a maior Execucao.
Ao encontrar uma execução mais recente, descarta todas as ofertas anteriores
da combinação, independentemente da ordem das linhas no arquivo. A recência
é selecionada antes de validar Site/preço: uma linha recente com Site vazio
ou preço inválido ainda identifica um snapshot vazio e impede recuperar uma
oferta antiga. Linhas sem identidade/data/execução válida são ignoradas.

Ofertas exigem Site textual não vazio após trim e Preco_Num do tipo number,
finito e maior que zero. Valores null, strings, zero e negativos são ignorados.
Cada linha válida gera uma oferta, inclusive duplicatas e empates; a ordenação
é estável por preço crescente. bestPrice/bestProvider vêm da primeira oferta.
Preco_Min nunca determina o preço e campos históricos não preenchem lacunas.

## Estados e logs

| Situação | Status |
| --- | --- |
| Pelo menos uma oferta válida na última execução | success |
| Array vazio, combinação ausente ou snapshot sem ofertas válidas | unavailable |
| URL ausente/inválida, HTTP de erro, falha de rede ou timeout | error |
| HTML, JSON malformado, raiz não array ou nenhuma linha reconhecível | error |

Os estados sem sucesso mantêm bestPrice/bestProvider null e offers vazio.
Todos mantêm o link de pesquisa manual. Não há fallback para coleta live.

Eventos server-side:

- `TRIVAGO_JSON_FETCH_START`.
- `TRIVAGO_JSON_FETCH_SUCCESS`: records (linhas recebidas), durationMs.
- `TRIVAGO_JSON_INVALID_RECORDS`: count (linhas inválidas ou sem oferta válida).
- `TRIVAGO_JSON_LOOKUP`: hotelSlug, date, adults, snapshotExecution, offersCount.
- `TRIVAGO_JSON_ERROR`: categoria e mensagem controlada, sem erros brutos,
  URL, corpo do arquivo, tokens ou parâmetros assinados.

## Auditoria da migração

A implementação anterior concentrava parsing GraphQL/DOM, interceptação,
retries, semáforo global, deduplicação live e compartilhamento de browsers em
`trivago-pricing-provider.ts`. Os módulos `browser.ts` e
`browser-diagnostics.ts` implementavam launcher local/serverless, checks de
binário e diagnóstico. Os três arquivos foram removidos.

Também foram removidos os cinco scripts antigos `check-trivago-browser.mts`,
`check-trivago-bundle.mjs`, `check-trivago-curi-executive-live.mts`,
`check-trivago-hotels-live.mts` e `check-trivago-dashboard-resilience.mts`, e os
cinco testes `trivago-browser.test.mts`, `trivago-browser-diagnostics.test.mts`,
`trivago-curi-executive.test.mts`, `trivago-hotels.test.mts` e
`trivago-serverless.test.mts`. Os scripts npm correspondentes, postbuild e
configurações de tracing/externalização de browser no Next foram removidos.

`trivago-curi-executive.md` foi substituído por este contrato; a documentação
Vercel foi atualizada. O mapa de hotéis/property IDs e a construção dos links
foram preservados em `hotel-configs.ts`.

Playwright permanece em devDependencies por causa do teste visual local
`scripts/check-ui.mjs`. O pacote `playwright-core` permanece transitivo para
esse teste; `@sparticuz/chromium` e suas dependências exclusivas saem do lockfile.
Não há importação de navegador em src nem inclusão de binários na função.
As referências de navegador em `.gitignore` e `audit-secrets.mjs` continuam
protegendo artefatos sensíveis do teste visual. A documentação histórica
Desbravador identifica explicitamente a integração removida; suas referências
a browser descrevem o passado. A documentação HBook informa ausência de browser.

As ocorrências de `trivago.com.br` no código/testes servem exclusivamente
à construção ou validação de links manuais. A lógica GraphQL da Accor é de
outro provider e permanece intacta. Providers oficiais, UI, comparações e
gráfico não foram alterados.

## Validação reproduzível

`npm run test:trivago-json` usa uma fixture representativa de 13 linhas e HTTP
local para testar redirects. A integração chama o mesmo `searchPricing` usado
pelo dashboard, verifica 1 download para 7 hotéis/10 diárias, atualização entre
buscas, isolamento de buscas simultâneas e contratos oficiais preservados.
As chamadas oficiais no teste de registry são simuladas; outro teste usa o
parser HBook real com transporte fictício nos três estados do JSON.

Após configurar a URL, execute:

```bash
npm run test:trivago-json:live -- --check-in=2026-09-11 --nights=1 --adults=2
```

Substitua o exemplo por uma data atual/futura coberta pelo arquivo. O script
usa os sete hotéis e o mesmo serviço/registry do dashboard, com os providers
oficiais reais. Ele não requer login e não consulta o catálogo Supabase;
para validar também autenticação/catálogo/UI, repita a pesquisa no dashboard.
Confirme os eventos JSON e os resultados oficiais. Se a URL não estiver
configurada, o script termina com instrução de configuração, sem coletar preços.

Verificações completas: `npm test`, `npm run lint` e `npm run build`.

### Resultado da validação da migração (11/09/2026)

- `npm test`: 93 testes aprovados, 0 falhas, incluindo 19 testes novos do JSON.
- `npm run lint`: aprovado, sem avisos ou erros.
- `npm run build`: aprovado, incluindo verificação TypeScript.
- Trace de produção do dashboard: 117 arquivos, nenhum arquivo de navegador.
- Bundle cliente: nenhuma ocorrência da chave `TRIVAGO_JSON_URL`.
- `audit-secrets.mjs`: nenhuma ocorrência sensível detectada.
- Diff dos providers oficiais, componentes de pricing, comparações e provider
  híbrido: vazio.
- Auditoria de código: nenhum coletor/launcher Trivago; o domínio Trivago em
  src aparece apenas na função que constrói o link manual. Nenhuma ocorrência
  do nome da operação GraphQL antiga ou dos eventos antigos de scraping.
- Teste com OneDrive real pendente: `TRIVAGO_JSON_URL` não estava configurada
  no ambiente. O comando live foi executado e encerrou com a instrução de
  configuração, sem iniciar consultas. Os testes automatizados usam fixtures
  e servidor HTTP local; não constituem homologação do arquivo real.
