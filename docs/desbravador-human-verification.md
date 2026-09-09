# Verificação humana no Desbravador

> Documento histórico. O fluxo human-in-the-loop, suas rotas e sessões foram
> removidos. Os três hotéis Desbravador agora exibem somente o link externo da
> pesquisa; nenhuma automação de navegador é iniciada.

## Escopo

Os três hotéis abaixo usam a mesma classe `DesbravadorOfficialProvider`, com configuração centralizada em `src/providers/pricing/official-sites/desbravador.ts`:

| Hotel | Slug da plataforma | Slug Desbravador |
| --- | --- | --- |
| Hotel Alles Blau | `hotel-alles-blau` | `hotel-alles-blau` |
| Jacques Georges Tower | `jacques-georges-tower` | `hotel-jacques-georges-tower` |
| M Tower Hotel | `m-tower-hotel` | `m-tower-hotel` |

Hotel Jacques Georges Business não participa: seu site oficial continua desabilitado. Os providers de Curi Executive, Curi Palace e ibis Pelotas e o mock do Trivago não são alterados por este fluxo.

O sistema automatiza a pesquisa, mas não clica, resolve, terceiriza ou contorna reCAPTCHA. A única ação humana é concluir o desafio na janela correta quando solicitado.

Na verificação de 28/08/2026, as três URLs renderizaram o mesmo Reservas On-Line v3.0.2, com a mesma navegação, breadcrumb, período selecionado, mensagem de validação e iframe reCAPTCHA. As diferenças visíveis ficaram restritas aos dados do hotel. O schema pós-validação ainda deve continuar protegido por fixtures e testes, pois é uma interface interna do fornecedor.

## Arquitetura local

`DesbravadorOfficialProvider` gera a URL, executa a integração Basic opcional, inicia o fallback human-in-the-loop e normaliza o schema comum de quartos, disponibilidade e tarifas. As diferenças entre hotéis ficam em `DESBRAVADOR_HOTELS`; não existem providers ativos concorrentes para os mesmos hotéis.

`DesbravadorBrowserSessionManager` mantém um `Map` process-local. Cada consulta possui browser, context e page próprios e registra internamente:

- `verificationSessionId` aleatório;
- `userId` proprietário;
- slug da plataforma e slug Desbravador;
- check-in, check-out e adultos originais;
- estado, expiração, payloads e resultado normalizado.

O listener valida também o `hotelLoginRQ.slug` e as datas antes de aceitar uma resposta JSON. Assim, uma página do M Tower não pode alimentar uma sessão do Alles Blau ou do Jacques Tower.

O cliente recebe apenas identificador, hotel, estado, mensagem, `searchUrl` e ofertas normalizadas. `userId`, cookies, tokens, headers e storage nunca são retornados.

## Sequência e estados

1. A Server Action revalida autenticação, perfil ativo e role `admin` ou `client`.
2. O provider tenta a integração oficial Basic quando aquele hotel possui credenciais server-side configuradas.
3. Sem credencial, com autorização recusada ou com desafio humano, inicia uma sessão Playwright isolada.
4. O Chromium abre com `headless=false`, inicialmente fora da tela, na URL exata com datas, 1 ou 2 adultos, um quarto e zero crianças.
5. Se não houver CAPTCHA, segue diretamente para `collecting`.
6. Se houver CAPTCHA, entra em `waiting_for_human_verification`. O botão “Validar acesso” revela a mesma janela.
7. Depois que o usuário resolve o desafio, a sessão detecta a liberação e continua sozinha.
8. As respostas JSON da própria página são observadas e normalizadas em `roomName`, `rateName`, `price`, `breakfastIncluded`, `refundable` e `currency`.
9. `bestPrice` é sempre o menor preço válido das ofertas, independentemente de quarto ou política.
10. O browser fecha e o polling de 1,5 segundo atualiza a pesquisa e os cálculos competitivos existentes.

```text
searching
  -> collecting -> success | unavailable | error
  -> waiting_for_human_verification
       -> collecting -> success | unavailable | error
       -> expired
```

O timeout humano padrão é cinco minutos. Um browser fechado, resposta inválida ou timeout de coleta resulta em `error`; três payloads válidos sem ofertas resultam em `unavailable`.

## Endpoints e segurança

```text
GET  /api/pricing/desbravador/{sessionId}/status
POST /api/pricing/desbravador/{sessionId}/verify
```

Ambos revalidam autenticação, perfil ativo, role permitida e propriedade. ADMIN e CLIENT acessam somente sessões que eles próprios iniciaram. Sessão inexistente ou de outro usuário responde como não encontrada; o POST também valida a origem.

## Concorrência e storageState

Até três sessões locais podem ficar ativas simultaneamente por padrão. Cada uma usa browser/context/page exclusivos; portanto, não foi necessária fila. Ao atingir o limite, uma nova consulta falha de forma controlada, sem compartilhar uma janela existente.

O estado validado é individual por usuário e hotel:

```text
.playwright-state/desbravador/<sha256(userId:desbravadorSlug)>.json
```

A pasta está no `.gitignore`. Não há compartilhamento presumido entre hotéis, mesmo que todos usem o mesmo domínio. Uma nova consulta sempre detecta novamente a presença de CAPTCHA.

Configurações locais:

```dotenv
DESBRAVADOR_HUMAN_TIMEOUT_MS=300000
DESBRAVADOR_COLLECTION_TIMEOUT_MS=45000
DESBRAVADOR_MAX_SESSIONS=3
```

Instale o Chromium uma vez com `npm run playwright:install`.

## Como adicionar outro hotel

1. Inclua uma entrada em `DESBRAVADOR_HOTELS` com nome, slug da plataforma e slug Desbravador.
2. Confirme que a tabela `hotels` habilita o site oficial para o mesmo slug da plataforma.
3. Valide URL, schema de quartos/tarifas/disponibilidade e nomes de campos com fixtures.
4. Só adicione uma estratégia de parsing na configuração se uma diferença real de schema for comprovada; não copie o provider.
5. Adicione testes de URL, ocupação, extração, indisponibilidade e isolamento.

## Produção

O fluxo local depende de processo persistente e Chromium gráfico e não deve rodar dentro de uma função Vercel Serverless. A evolução prevista é:

```text
Next.js / Vercel -> API autenticada -> Desbravador Worker -> Playwright
```

O worker pode rodar em Railway, Render, Fly.io, VPS ou infraestrutura própria e oferecer acesso temporário à janela por streaming seguro, como noVNC/WebRTC. Ele deve preservar autenticação curta vinculada a `userId + sessionId`, limites, expiração, storage criptografado e logs sem tokens.

## Testes

Os testes automatizados simulam apenas o evento `human_verified`; nunca interagem com CAPTCHA. Eles cobrem configuração dos três hotéis, URLs, extração, `bestPrice`, propriedade, sessão correta, concorrência, isolamento de resultados e storage, expiração e erro.

Os testes reais exigem uma pessoa para concluir qualquer reCAPTCHA apresentado. Depois disso, a aplicação deve atualizar o card sem novo clique em “Buscar preços”.
