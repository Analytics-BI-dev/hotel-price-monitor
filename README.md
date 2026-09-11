# Hotel Price Monitor

Plataforma autenticada para comparar, por diária, o Hotel Curi Executive com seis concorrentes de Pelotas. A composição híbrida preserva os providers de site oficial e lê o JSON diário do Trivago, com mapeamento explícito para os sete hotéis. Não há histórico persistente.

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
TRIVAGO_JSON_URL=
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
npm test
npm run test:trivago-json
npm run lint
npm run build
```

Os testes de pricing cobrem períodos de 1, 10 e 11 diárias, ocupação, determinismo, ausência do site oficial e as fórmulas de comparação.

## Site oficial do Hotel Curi Executive

O Curi Executive usa o HBook da HSystem. O provider abre a pesquisa pública server-side para obter um token efêmero de disponibilidade e consulta o endpoint JSON do HBook. Não são usados cookies, login, CAPTCHA ou Playwright nessa fonte oficial. O JSON do Trivago é uma fonte separada e não altera o HBook.

Para testar o parser e a composição sem rede:

```bash
npm run test:curi-executive
```

Para executar quatro consultas reais, com 1 e 2 adultos em duas datas:

```bash
npm run test:curi-executive:live
```

O script não efetua reservas e imprime a `searchUrl` de cada caso para validação manual. O contrato observado está documentado em `docs/curi-executive-hbook.md`.

## Trivago: JSON diário

A única fonte automática do Trivago é o arquivo JSON atualizado externamente
no OneDrive. Configure `TRIVAGO_JSON_URL` no `.env.local` (somente no servidor,
sem prefixo `NEXT_PUBLIC_`). O valor real não deve ser versionado.

A URL precisa retornar o **conteúdo JSON diretamente**, sem login. Redirects
HTTP são seguidos normalmente. Se um link de compartilhamento retornar HTML,
a consulta retorna `error` e o servidor registra uma mensagem solicitando uma
URL de download/conteúdo direto. Não há parsing de HTML nem autenticação Graph.

Cada clique em “Buscar preços” cria um repositório novo, baixa o arquivo uma
vez com `cache: "no-store"` e timeout de 15 segundos, valida com Zod e indexa
os snapshots em memória. **7 hotéis × 10 diárias = 1 download**, compartilhado
entre todas as consultas daquela busca. A próxima busca lê novamente a fonte;
atualizar o conteúdo na mesma URL não exige restart, rebuild ou redeploy.

O mapeamento central de slugs, nomes exatos do JSON e property IDs está em
`src/providers/pricing/trivago/hotel-configs.ts`. Para cada diária, os filtros
são Hotel + Data + hospedes. Data usa DD-MM-YYYY e é validada explicitamente.
Execucao usa YYYY-MM-DD HH:mm:ss: só a execução mais recente da combinação pode
fornecer ofertas, mesmo quando não possui preços válidos. Turno não define recência.

Ofertas precisam de Site não vazio e Preco_Num numérico, finito e positivo.
Elas são ordenadas pelo preço, com empate estável. bestPrice é o menor preço
válido e bestProvider é o Site da primeira oferta mínima. Preco_Min e campos
de histórico não são usados. Sem cobertura ou sem ofertas válidas, o resultado
é unavailable; falhas técnicas do arquivo são error.

O Trivago não usa mais scraping, GraphQL ou navegador e não possui fallback
live. “Abrir pesquisa ↗” continua sendo uma URL montada localmente com os sete
property IDs preservados. A UI, as comparações e o gráfico não foram alterados.

Para testar sem OneDrive:

```bash
npm run test:trivago-json
```

Depois de configurar a URL, execute o serviço usado pelo dashboard com uma
data atual/futura coberta pelo arquivo (substitua a data do exemplo):

```bash
npm run test:trivago-json:live -- --check-in=2026-09-11 --nights=1 --adults=2
```

Esse comando usa o registry de produção e os providers oficiais atuais. No
dashboard autenticado, faça a mesma pesquisa para conferir o resultado visual.
Veja o contrato, os logs e a auditoria em [docs/trivago-json.md](docs/trivago-json.md).

## Site oficial do Curi Palace Hotel

O Curi Palace também usa o HBook da HSystem, com identificador público e `searchUrl` próprios. A coleta server-side consulta o endpoint JSON de disponibilidade e preserva todas as combinações de acomodação e tarifa. O provider oficial não foi alterado; a coluna Trivago usa o provider JSON.

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

O site da Atrio encaminha as reservas do ibis Pelotas ao motor ALL/Accor. O provider consulta server-side o GraphQL público da Accor em BRL, mantém tarifas públicas e de membro, acrescenta somente os impostos obrigatórios informados e consulta cada diária separadamente. A coluna Trivago usa o provider JSON.

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
Trivago quando disponível. O provider JSON do Trivago permanece independente.

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

O Trivago usa apenas fetch de JSON no runtime Node.js. Cadastre também
TRIVAGO_JSON_URL como variável server-side no ambiente de produção. A função
não precisa de navegador nem de binário adicional. O dashboard mantém Node
24.x e o limite atual de 300 segundos para permitir as consultas oficiais.

Veja [docs/trivago-vercel.md](docs/trivago-vercel.md).

## Teste visual local opcional

Playwright permanece somente em devDependencies porque scripts/check-ui.mjs
valida os componentes reais da interface com dados fictícios. Para executar
esse teste local, use npm run playwright:install e node scripts/check-ui.mjs.
Essa instalação de Chromium é exclusiva do teste visual e não é necessária
para buscar preços, fazer build ou publicar a aplicação.
