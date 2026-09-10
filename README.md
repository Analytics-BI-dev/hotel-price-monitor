# Hotel Price Monitor

Plataforma autenticada para comparar, por diária, o Hotel Curi Executive com seis concorrentes de Pelotas. A composição híbrida preserva os providers de site oficial e usa um único provider real do Trivago, parametrizado para os sete hotéis. Não há histórico persistente.

## Configuração local

Instale as dependências:

```bash
npm install
```

Crie um arquivo `.env.local` na raiz do projeto. Ele deve permanecer apenas no ambiente local e nunca deve ser enviado ao Git:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_JWKS_URL=
TRIVAGO_MAX_CONCURRENCY=3
```

Depois, execute:

```bash
npm run dev
```

A aplicação estará disponível em `http://localhost:3000`.

## Estrutura esperada no Supabase

O projeto usa o Supabase Auth e a tabela existente `public.profiles`. Cada perfil deve ter os campos `id`, `name`, `email`, `role`, `active` e `created_at`. As roles aceitas são `admin` e `client`.

O cadastro de Auth deve manter o trigger existente que cria o profile automaticamente. A aplicação não salva senhas em tabelas públicas.

### Hotéis

A migration versionada está em `supabase/migrations/202608270001_create_hotels.sql`. Ela é segura para uma tabela `public.hotels` já existente: usa `create table if not exists`, habilita RLS, concede somente leitura aos usuários autenticados e ativos e limita o banco a no máximo um hotel de referência.

O arquivo `supabase/seed.sql` contém um upsert idempotente dos sete hotéis. Em um projeto novo, aplique primeiro a migration e depois execute o conteúdo do seed no SQL Editor do Supabase. Reexecutar o seed não cria duplicados porque o conflito é resolvido pelo `slug`.

O projeto Supabase usado no desenvolvimento já possuía a tabela compatível e os sete registros corretos; nenhuma recriação ou alteração de hotel foi necessária durante a implementação.

## Validação local

```bash
npm run test:login
npm run test:pricing
npm run lint
npm run build
```

Os testes de pricing cobrem períodos de 1, 10 e 11 diárias, ocupação, determinismo, ausência do site oficial e as fórmulas de comparação.

## Site oficial do Hotel Curi Executive

O Curi Executive usa o HBook da HSystem. O provider abre a pesquisa pública server-side para obter um token efêmero de disponibilidade e consulta o endpoint JSON do HBook. Não são usados cookies, login, CAPTCHA ou Playwright nessa fonte oficial. A coleta Trivago real é um provider separado e não altera o HBook.

Para testar o parser e a composição sem rede:

```bash
npm run test:curi-executive
```

Para executar quatro consultas reais, com 1 e 2 adultos em duas datas:

```bash
npm run test:curi-executive:live
```

O script não efetua reservas e imprime a `searchUrl` de cada caso para validação manual. O contrato observado está documentado em `docs/curi-executive-hbook.md`.

## Trivago real dos sete hotéis

O `TrivagoPricingProvider` é genérico. A configuração central em
`src/providers/pricing/trivago/hotel-configs.ts` associa cada slug ao property
ID correto; o registry cria sete instâncias da mesma classe. A resposta GraphQL
estruturada é a fonte primária e só é aceita quando pertence inequivocamente ao
property ID esperado. O DOM é fallback: primeiro há leitura sem clique e a
expansão visual só é tentada quando faltam dados estruturados.

| Hotel | Property ID |
| --- | ---: |
| Hotel Curi Executive | 2436946 |
| Curi Palace Hotel | 1180090 |
| Hotel Alles Blau | 7770070 |
| Jacques Georges Tower | 3387958 |
| Hotel Jacques Georges Business | 3487706 |
| ibis Pelotas | 48115946 |
| M Tower Hotel | 2899803 |

Cada pesquisa continua sendo dividida por diária e preserva a ocupação. O menor
preço é calculado sobre todas as ofertas válidas retornadas. Pesquisas idênticas
em andamento são deduplicadas em memória por
`propertyId|checkIn|checkOut|adults`, sem cache persistente.

O coletor abre um Chromium por lote de hotel e um contexto isolado para esse
lote. Páginas, contexto e browser são sempre fechados. Um semáforo global limita
a coleta a no máximo três browsers simultâneos; `TRIVAGO_MAX_CONCURRENCY` aceita
valores de 1 a 3 e usa 3 por padrão. HTTP 408, 429, 5xx e timeouts de navegação
ou GraphQL têm no máximo três tentativas. O limite é local ao processo.

Instale o Chromium local e execute os testes:

```bash
npx playwright install chromium
npm run test:trivago-curi
npm run test:trivago-hotels
npm run test:trivago-curi:live
npm run test:trivago-hotels:live -- --check-in=2026-09-10 --nights=1 --adults=1
```

O teste dos sete hotéis aceita `--nights=1..10` e `--adults=1|2`, imprime
`status`, ofertas, melhor preço, fornecedor, duração e `searchUrl`, e nunca
efetua clickout ou reserva. Os logs de desenvolvimento incluem apenas hotel,
datas, tentativas, status HTTP, categoria e duração; não registram cookies,
tokens ou outros dados sensíveis. A investigação de rede e o contrato observado
estão em `docs/trivago-curi-executive.md`.

## Site oficial do Curi Palace Hotel

O Curi Palace também usa o HBook da HSystem, com identificador público e `searchUrl` próprios. A coleta server-side consulta o endpoint JSON de disponibilidade e preserva todas as combinações de acomodação e tarifa. O provider oficial não foi alterado; a coluna Trivago usa o provider real genérico.

Para testar parser, estados de erro e composição híbrida sem rede:

```bash
npm run test:curi-palace
```

Para executar quatro consultas reais, com 1 e 2 adultos em duas datas:

```bash
npm run test:curi-palace:live
```

O script imprime a `searchUrl` para conferência manual e nunca efetua reservas. O contrato completo está em `docs/curi-palace-hbook.md`.

## Site oficial do ibis Pelotas

O site da Atrio encaminha as reservas do ibis Pelotas ao motor ALL/Accor. O provider consulta server-side o GraphQL público da Accor em BRL, mantém tarifas públicas e de membro, acrescenta somente os impostos obrigatórios informados e consulta cada diária separadamente. A coluna Trivago usa o provider real genérico.

Para testar normalização, impostos, ocupação, múltiplas tarifas e composição híbrida sem rede:

```bash
npm run test:ibis-pelotas
```

Para executar seis casos reais, incluindo duas datas, 1 e 2 adultos e uma estadia de duas noites:

```bash
npm run test:ibis-pelotas:live
```

O script não realiza reservas e imprime somente resultados normalizados e `searchUrl`. O contrato técnico está em `docs/ibis-pelotas-accor.md`.

## Sites oficiais Desbravador (somente link)

Hotel Alles Blau, Jacques Georges Tower e M Tower Hotel usam o provider
`ExternalLinkOnlyOfficialProvider`. Ele monta localmente a URL da pesquisa com
hotel, check-in, check-out, adultos e zero crianças. O resultado oficial sempre
possui `bestPrice: null` e `offers: []`; não há fetch, API interna, Basic Auth,
Playwright, sessão de navegador, CAPTCHA, retry ou parser de preços.

Na interface, a coluna e o detalhamento do Site oficial mostram somente
“Abrir pesquisa ↗”. O preço competitivo desses hotéis vem exclusivamente do
Trivago quando disponível. O provider real do Trivago permanece independente e
continua usando Playwright.

Valide as três URLs, a ausência de rede e a composição com o Trivago usando:

```bash
npm run test:external-link-only
```

Os documentos `docs/desbravador-rol.md`,
`docs/desbravador-human-verification.md` e `docs/m-tower-desbravador.md` foram
mantidos somente como histórico técnico da integração removida.

## Publicação na Vercel

Quando o projeto for publicado, adicione em **Vercel > Settings > Environment Variables** as variáveis listadas acima para os ambientes necessários.

A `SUPABASE_SECRET_KEY` deve ser cadastrada diretamente na Vercel. Nunca adicione seu valor ao GitHub, ao README ou a uma variável iniciada por `NEXT_PUBLIC_`.

O Trivago agora seleciona automaticamente `@sparticuz/chromium` nos deployments
Vercel e mantém o Chromium do Playwright no desenvolvimento local (incluindo
`vercel dev`). O binário Linux acompanha a função de `/dashboard`; não é
necessário instalar Chromium no build da Vercel nem contratar um worker externo
para esta implementação. Não há download de binários por URL durante a consulta.

O dashboard usa Node.js e `maxDuration = 300` segundos. Ative Fluid Compute,
configure Node 24.x e comece com `TRIVAGO_MAX_CONCURRENCY=1` em 2 GB de memória.
Com 4 GB, teste concorrência 2 antes de aumentá-la. Os limites e a deduplicação
em memória continuam valendo por instância, não globalmente. Consultas longas
podem exceder os 300 segundos e precisam de validação no deploy; não existe
garantia de completar 10 diárias em qualquer condição de rede.

Veja o passo a passo e a matriz de diagnóstico em
[docs/trivago-vercel.md](docs/trivago-vercel.md). O smoke test offline do launcher
é `npm run test:trivago-browser`. A abertura real do binário Linux e o acesso ao
Trivago a partir do IP da Vercel devem ser homologados após a publicação.
