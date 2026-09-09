# Trivago — Hotel Curi Executive

## Escopo

O provider genérico atende os sete hotéis cadastrados em
`src/providers/pricing/trivago/hotel-configs.ts`. O exemplo deste documento usa
`hotel-curi-executive`, propriedade Trivago `2436946`.

## Investigação do fluxo

A página canônica observada foi:

```text
https://www.trivago.com.br/pt-BR/lm/hotel-curi-executive-pelotas?search=100-2436946;dr-AAAAMMDD-AAAAMMDD;drs-40;rc-1-ADULTOS
```

O parâmetro `100-2436946` seleciona a propriedade sem pesquisa textual. `dr`
leva check-in e check-out, `drs-40` é a origem de datas usada pela interface e
`rc-1-1`/`rc-1-2` representa um quarto com um ou dois adultos e sem crianças.

O HTML inicial contém `__NEXT_DATA__` em base64, com o estado da pesquisa e a
operação `accommodationSearchPrefetch`, mas não contém as tarifas finais. A
interface carrega os resultados por:

```text
POST https://www.trivago.com.br/graphql?accommodationSearchQuery
Content-Type: application/json
```

O corpo usa uma persisted query e informa, entre outros campos:

- `params.uiv[0].nsid = { ns: 100, id: 2436946 }`;
- `params.stayPeriod.arrival` e `departure`;
- `params.rooms = [{ adults, children: [] }]`;
- `params.currency = "BRL"`;
- `params.dealsLimit`, paginação, ordenação e contexto da pesquisa.

A resposta JSON usa `data.accommodationSearchResponse`, com acomodações,
`nsid`, ofertas, preço, anunciante e metadados. A operação é interna e não é um
contrato público: hashes, versão do cliente e cabeçalhos de correlação mudam
com os releases do Trivago.

Durante a investigação, o transporte de streaming iniciado diretamente pelo
Chromium headless retornou intermitentemente HTTP 408 (`stream timeout`). O
mesmo request público, enviado server-side sem `Cookie` e sem `Authorization`,
retornou JSON 200. Por isso o provider mantém o Playwright apenas para o app do
Trivago gerar os parâmetros/correlações atuais e executa server-side as duas
operações de leitura (`accommodationSearchQuery` e
`accommodationSearchDeals`). Cookies e authorization são removidos antes da
chamada. A resposta é devolvida à própria página, que mantém o polling e a
associação de ofertas.

## Extração e normalização

A fonte primária é `data.accommodationSearchResponse`. A coleta localiza a
acomodação cujo `nsid` é exatamente `{ ns: 100, id: 2436946 }`, percorre
`deals.best`, todos os itens de `deals.alternatives` e `deals.cheapest`, valida
novamente o `accommodationDetails.nsid` de cada deal e elimina duplicatas. O
preço usa `allInPricePerNight.amount` (com `pricePerNight.amount` como fallback)
e o fornecedor é associado pelo `advertiserDetails.nsid` observado na própria
integração.

Quando essa estrutura está completa e contém preço e fornecedor, o provider
retorna imediatamente: não localiza card, não clica e não abre o painel. O DOM
é fallback para resposta vazia, incompleta ou não interpretável. Nesse fallback,
o card exato é lido primeiro sem clique; a expansão só é tentada para enriquecer
as ofertas e uma falha de expansão não descarta dados GraphQL já válidos.

O menor valor é calculado sobre todos os deals estruturados disponíveis. Assim,
uma oferta alternativa mais barata prevalece sobre a oferta destacada.

Quarto, café e reembolso podem ser mantidos internamente quando presentes na
oferta estruturada ou no fallback DOM. A interface expandida mostra somente
fonte e preço; o caminho GraphQL completo não lê o DOM para enriquecer detalhes.
O `offerUrl` usa a própria `searchUrl`, pois os clickouts das
agências são gerados dinamicamente e não são tratados como links estáveis.

## Estados, segurança e resiliência

- Resultado válido sem oferta: `unavailable`.
- Falha HTTP, JSON, DOM, parsing ou timeout: `error`.
- CAPTCHA, reCAPTCHA, 403 ou desafio anti-bot: `manual_verification_required`.
- HTTP 408, 429, 5xx e timeouts transitórios: no máximo três tentativas; após
  esgotá-las, `error`. HTTP 429 isolado não é interpretado como CAPTCHA.
- Nenhum CAPTCHA é resolvido, contornado ou enviado a serviço externo.
- Nenhum cookie, token, authorization ou estado de sessão é registrado.
- Chromium ausente: `browser_not_installed` no log, resultado `error` e nenhuma
  repetição inútil. Instale com `npx playwright install chromium` no runtime.

Os logs de desenvolvimento são `TRIVAGO_SEARCH_START`, `TRIVAGO_ATTEMPT`,
`TRIVAGO_PAGE_LOADED`, `TRIVAGO_GRAPHQL_DETECTED`,
`TRIVAGO_GRAPHQL_STATUS`, `TRIVAGO_OFFERS_PARSED`, `TRIVAGO_RETRY`,
`TRIVAGO_SEARCH_SUCCESS` e `TRIVAGO_SEARCH_ERROR`. Eles não registram headers,
cookies, tokens nem corpo de request. Em produção permanecem somente início,
sucesso, erro e retry em JSON, com campos permitidos explicitamente.

O limite process-local é `TRIVAGO_MAX_CONCURRENCY`, padrão e teto de três
navegadores. A mesma busca em andamento é deduplicada por propriedade, datas e
adultos; não existe cache persistente. Cada tentativa abre um browser e um
contexto isolado, reaproveitados apenas entre as diárias daquela busca. Páginas,
contexto e browser são fechados em `finally`; fechar a página também aborta
chamadas GraphQL server-side pendentes. A fila não tem coordenação entre várias
instâncias serverless.

## Validação real em 31/08/2026

Os preços são voláteis; estes valores são somente a fotografia do teste:

| Diária | Adultos | Menor oferta | Quantidade coletada | Conferência manual |
| --- | ---: | --- | ---: | --- |
| 10/09 → 11/09 | 1 | Expedia — R$ 224 | 12 | mesma URL; destaque Booking.com R$ 259 |
| 10/09 → 11/09 | 2 | HRS.com — R$ 289 | 16 | mesma URL e mesma oferta |
| 17/09 → 18/09 | 1 | Expedia — R$ 224 | 12 | mesma URL; destaque Booking.com R$ 249 |
| 17/09 → 18/09 | 2 | HRS.com — R$ 289 | 16 | mesma URL e mesma oferta |

Em 31/08/2026, após tornar a GraphQL primária, cinco execuções de
31/08 → 01/09 para um adulto retornaram três deals estruturados, Expedia por
R$ 224, sem DOM e sem expansão. O teste de dois adultos retornou três deals,
HRS.com por R$ 289, também sem DOM e sem expansão. A conferência da URL manual
mostrou no card exato Expedia por R$ 224 como a menor oferta alternativa.

Isso confirmou nos dois casos de um adulto que a oferta destacada não era a
menor e que o cálculo precisa percorrer todas as ofertas.

Os testes podem ser repetidos com:

```bash
npm run test:trivago-curi
npm run test:trivago-curi:live
```

Para escolher a primeira data do teste real, defina temporariamente
`TRIVAGO_CURI_TEST_CHECKIN=AAAA-MM-DD`. O script usa também uma segunda data,
sete dias depois, e não efetua clickout ou reserva.

## Limitações e Vercel

O Trivago não oferece contrato público estável para esta pesquisa. Mudanças em
persisted queries, cabeçalhos internos, traduções ou `data-testid` podem exigir
manutenção. Também foram observados HTTP 408 intermitentes quando várias
consultas são executadas em sequência; depois do retry limitado, uma falha
continua sendo `error`, nunca falsa indisponibilidade.

O provider exige Chromium no runtime Node.js. O build da aplicação é
compatível, mas uma função serverless padrão da Vercel pode não incluir o
binário ou pode exceder limites de tamanho/tempo. Antes de produção, validar o
bundle no ambiente alvo e, se necessário, executar este provider em worker ou
container próprio com Chromium. Não mover a coleta para o navegador do cliente.

## Próximo hotel

Para outro hotel, descobrir e validar a página canônica e cadastrar outra
instância de `TrivagoPricingProvider` com `propertyId`, `hotelName`,
`hotelSlug` e `searchPathSlug`. Somente depois registrar essa instância no mapa
`trivagoProviders`; não é necessário alterar o provider genérico nem o mock dos
hotéis ainda não migrados.
