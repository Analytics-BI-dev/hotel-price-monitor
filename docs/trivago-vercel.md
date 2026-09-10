# Trivago dentro da Vercel

## O que está implementado

- O mesmo provider e a mesma Server Action do dashboard passam a abrir Chromium
  por `src/providers/pricing/trivago/browser.ts`.
- Em Vercel Production/Preview (`VERCEL=1`), usa `@sparticuz/chromium@152.0.0`,
  com binários Linux x64 e bibliotecas AL2023 incluídos na dependência de produção.
- Em ambiente local e `vercel dev`, usa o Chromium instalado pelo Playwright.
- O Next externaliza os pacotes e inclui explicitamente os quatro arquivos
  `bin/*.br` no tracing de `/dashboard`. Não usa URL externa para baixar browser
  durante a consulta, storageState ou um serviço remoto de navegador.
- A extração do executável é deduplicada por processo; browsers e contextos não
  são compartilhados. O fechamento em `finally` e o semáforo original permanecem.
- Falha de inicialização retorna `browser_launch_error` ou
  `browser_not_installed`, sem retry de erro de infraestrutura nem logs brutos.
- O dashboard declara `runtime = "nodejs"` e `maxDuration = 300`, também aplicados
  às Server Actions da página. Nenhum endpoint público de teste foi criado.
- Datas, hóspedes, property IDs, GraphQL, parsers, preços, autenticação e os sites
  oficiais permanecem inalterados. CAPTCHA não é resolvido nem burlado.

## Passos fora do código

1. Execute localmente `npm ci`, `npm run lint`, `npm test`, `npm run build` e
   `node scripts/audit-secrets.mjs`. Envie os arquivos modificados e novos ao
   GitHub, incluindo `package-lock.json`. Não envie `.env.local`, `.next`,
   `node_modules`, cookies ou sessões de navegador.
2. Na Vercel, importe o repositório ou abra o projeto existente. Configure
   Framework **Next.js**, raiz na pasta com `package.json`, Node.js **24.x**,
   Install Command **npm ci**, Build Command **npm run build** e Output Directory
   padrão do Next.js. Não configure exportação estática.
3. Em **Settings > Functions**, mantenha **Fluid Compute** habilitado. Em 2 GB,
   comece com um browser simultâneo. Se o plano disponibilizar 4 GB, selecione
   essa memória e teste concorrência 2. Não altere runtime para Edge.
4. Em **Settings > Environment Variables**, copie os valores existentes de
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` e `SUPABASE_JWKS_URL`, sem aspas ou espaços extras.
   Adicione `TRIVAGO_MAX_CONCURRENCY=1` para começar. Aplique em Production e,
   apenas se necessário, Preview. Prefira Supabase separado para testes.
5. A Vercel fornece `VERCEL`/`VERCEL_ENV` automaticamente. Não crie essas
   variáveis no `.env.local`. Não cadastre `ADMIN_RESET_PASSWORD`, caminhos do
   Windows, `CHROMIUM_EXECUTABLE_PATH` ou uma URL de Chromium; não são necessários.
   Não execute `playwright install` no Build Command. Não exponha a chave secreta
   com prefixo `NEXT_PUBLIC_`.
6. Faça **Deploy** ou **Redeploy**. Alterações de ambiente só passam a valer em
   um novo deployment. Confirme nos detalhes da função `/dashboard` que o limite
   de duração é 300 segundos. Esse limite está definido no código; alterar
   somente o padrão de duração do projeto não o sobrescreve.
7. Abra `/login`, autentique-se com o usuário existente e consulte uma diária
   futura, 1 adulto. Confirme fonte, ofertas e preço em cada hotel. Depois teste
   2 adultos, 2 diárias e gradualmente o máximo de 10 diárias. Compare com
   **Abrir pesquisa** e monitore memória/duração nos logs do deployment.
8. Se aumentar concorrência para 2, faça novo deploy e repita a validação. O teto
   do código continua sendo 3, por processo, não um limite global de todas as
   instâncias da Vercel. Usuários simultâneos podem aumentar consumo e custos.

Não é necessário mudar banco, senha, roles ou políticas do Supabase.

## Diagnóstico no deployment

Ao investigar falhas de inicialização, expanda todas as mensagens da requisição
POST `/dashboard` e procure `TRIVAGO_BROWSER_ERROR`. Esse evento funciona também
em produção, sem variável adicional. Registra apenas dados técnicos permitidos:

- `stage`: `load_playwright`, `load_serverless_module`, `extract_executable`,
  `configure_arguments`, `inspect_executable` ou `launch_browser`;
- `reason`, `errorCode`, `missingLibrary`, `moduleHint`, `signal`, `exitCode`:
  valores reconhecidos por lista fechada, nunca mensagem/stack bruta;
- `nodeVersion`, `platform`, `architecture`, `browserRuntime`, `durationMs`;
- `executableExists`: `true`/`false` após a verificação, ou `null` se ainda não
  verificado (não confundir `null` com executável ausente);
- `browserLaunchId`: correlaciona `TRIVAGO_BROWSER_START`, `TRIVAGO_BROWSER_READY`
  e `TRIVAGO_BROWSER_ERROR` de uma tentativa de abertura.

`TRIVAGO_BROWSER_READY` confirma apenas a abertura do navegador, não a obtenção
de tarifas. `async_module_require` distingue incompatibilidade entre require e
módulo com top-level await; `shared_library_missing` indica dependência Linux;
`process_killed` sozinho não prova falta de memória. Motivos desconhecidos ficam
como `unclassified_browser_error`, sem expor o texto original.

Para coletar esse diagnóstico: envie as alterações ao GitHub, faça um novo
deployment e execute uma pesquisa de uma diária futura com um adulto. Copie o
JSON de `TRIVAGO_BROWSER_ERROR` e o `TRIVAGO_SEARCH_ERROR` correspondente. Não
precisa alterar credenciais, memória, concorrência ou habilitar logs brutos.

| Sinal nos logs | Interpretação / ação |
| --- | --- |
| `TRIVAGO_SEARCH_SUCCESS` | Confira também ofertas, preço e fornecedor na interface. |
| `browser_not_installed` | Confira se publicou o lockfile e `next.config.ts`; os arquivos `@sparticuz/chromium/bin/*.br` precisam estar na função. |
| `browser_launch_error` | Confira Node 24, runtime Linux x64, memória e os logs da plataforma. Não compartilhe logs com secrets. |
| `FUNCTION_INVOCATION_TIMEOUT` / HTTP 504 | A busca ultrapassou o tempo da função; não significa indisponibilidade do hotel. |
| encerramento por memória | Reduza concorrência para 1 e/ou aumente a memória disponível no plano. |
| `graphql_timeout` / `graphql_http_error` | O navegador pode ter iniciado; o serviço externo falhou ou demorou. |
| `manual_verification_required` | Bloqueio/CAPTCHA: mantenha consulta manual por link; não use bypass. |

Se pesquisas longas excederem 300 segundos, um plano com limite maior permite
elevar `maxDuration` no código e publicar novamente. Isso não resolve bloqueios
externos nem garante sucesso para 70 consultas diárias com retries. Para uso
intenso, uma evolução para jobs assíncronos ainda pode ser necessária; não faz
parte desta adaptação.

## Validação feita e limites

Em 10/09/2026: build passou; tracing de `/dashboard` incluiu `chromium.br`,
`al2023.tar.br`, `fonts.tar.br` e `swiftshader.tar.br` (aproximadamente 80 MiB no
trace local completo, não uma medição do bundle final Linux da Vercel).
O manifesto do Next confirmou `maxDuration: 300`.

Os testes cobrem seleção local/Preview/Production, argumentos, extração única,
browsers separados, recuperação após erro e ausência de dados sensíveis nos
erros. O smoke test real abriu o Chromium local 151.0.7922.34 e fechou os recursos.
O Playwright instalado permanece 1.62.1; o pacote serverless está fixado em 152.0.0
(não havia versão 151 disponível no npm consultado). A compatibilidade operacional
desse par precisa ser confirmada no deployment Linux, além dos testes de contrato.

O ambiente de desenvolvimento é Windows, sem Docker/WSL instalado: o binário
Linux não foi executado aqui. Não foi feito deploy, login remoto nem consulta de
tarifas a partir da Vercel. Build verde não comprova ausência de CAPTCHA/bloqueio
por IP nem que a busca completa cabe no limite da função.

## Referências oficiais

- [Chromium serverless e Playwright](https://github.com/Sparticuz/chromium#usage-with-playwright)
- [Limites das funções Vercel](https://vercel.com/docs/functions/limitations)
- [Duração de funções](https://vercel.com/docs/functions/configuring-functions/duration)
- [Memória e CPU](https://vercel.com/docs/functions/configuring-functions/memory)
- [Variáveis de ambiente](https://vercel.com/docs/environment-variables)
