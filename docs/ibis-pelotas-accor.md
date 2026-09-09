# Coleta do site oficial do ibis Pelotas

## Motor e pesquisa

O site `https://ibispelotas.atriohoteis.com.br/` usa um formulário WordPress/Gravity Forms apenas como ponte para o motor oficial **ALL/Accor**. O hotel é identificado publicamente como `B6N3`.

URL de pesquisa:

```text
https://all.accor.com/booking/pt-br/accor/hotel/B6N3
  ?dateIn=AAAA-MM-DD
  &nights=N
  &compositions=1|2
  &stayplus=false
```

- `dateIn`: check-in;
- `nights`: diferença entre check-out e check-in;
- `compositions`: uma composição representa um quarto; o valor `1` ou `2` representa os adultos desse quarto;
- a ausência de idades de crianças representa zero crianças;
- `stayplus=false`: pesquisa convencional, sem benefício Stay Plus.

Como a plataforma compara cada diária, cada resultado diário recebe uma `searchUrl` de uma noite para a mesma data e ocupação efetivamente consultadas.

## API estruturada

O cliente público da Accor usa GraphQL:

```text
POST https://api.accor.com/bff/v1/graphql
Content-Type: application/json
Accept: application/json
app-id: all.accor
lang: pt-br
apiKey: <chave pública obtida dinamicamente da página ALL>
```

A chave de aplicação está no próprio bundle/configuração pública do site. O provider não a mantém hardcoded: abre a página pública da pesquisa, extrai a configuração atual apenas em memória e nunca registra ou retorna seu valor.

Não são enviados cookie, `Authorization`, login, senha ou token de CAPTCHA.

Para cada noite, a consulta envia:

- `hotelId` e `hotelOffersHotelId`: `B6N3`;
- `dateIn` e `dateOut`: uma diária exata;
- `nbAdults`: `1` ou `2`;
- `childrenAges`: `[]`;
- `totalRoomInBasket`: `1`;
- `countryMarket`: `BR`;
- `currency`: `BRL`.

A mesma operação consulta duas visões do endpoint `hotelOffers`:

- `hideMemberRate=false`: tarifas de membro ALL;
- `hideMemberRate=true`: tarifas públicas sem associação.

Também consulta `hotel.accommodations` para mapear `product.id` ao nome real do quarto.

## Campos utilizados

- disponibilidade: `availability.status` e `availability.reasons`;
- ofertas: `offersSelection.offers[]`;
- acomodação: `product.id` e `hotel.accommodations[].name`;
- tarifa: `rate.id`, `rate.label` e `pricing.main.categories`;
- preço base: `pricing.main.amount`;
- moeda: `pricing.currency`;
- tipo de agregação: `pricing.aggregationType`;
- impostos obrigatórios: `pricing.formattedTaxType`;
- café: `mealPlan.code` e `mealPlan.label`;
- cancelamento: `pricing.main.simplifiedPolicies.cancellation`;
- duração: `lengthOfStay.value` e `lengthOfStay.unit`;
- ocupação: `occupancy.adults` e `occupancy.childrenAges`.

## Preço diário e impostos

O endpoint classifica o preço como `TOTAL_STAY`. O provider nunca divide esse total. Em pesquisas de várias noites, ele executa uma consulta independente de exatamente uma noite para cada diária da plataforma e exige `lengthOfStay=1` e `unit=NIGHT`.

O preço normalizado é o valor final obrigatório:

```text
pricing.main.amount + imposto obrigatório de pricing.formattedTaxType
```

Quando o campo informa que os impostos já estão incluídos, nada é somado. Quando informa impostos não incluídos e apresenta um valor explícito, esse valor é somado. Se o tratamento não puder ser determinado com segurança, a resposta vira erro técnico. Taxas opcionais, estacionamento, pet e extras não são adicionados.

Tarifas de membro e públicas são mantidas como ofertas distintas. A tarifa de membro aparece publicamente no motor e exige associação gratuita ao ALL para contratação; por ser a menor tarifa exibida ao consumidor, participa do `bestPrice`.

## Erros, disponibilidade e proteção

- resposta válida sem ofertas e com status não disponível: `unavailable`;
- HTTP, timeout, schema alterado, moeda incorreta ou imposto indeterminável: `error`;
- desafio Incapsula/CAPTCHA explícito bloqueando a consulta: `manual_verification_required`.

O site carrega recursos da Incapsula, mas nenhum desafio bloqueou a página ou o GraphQL nos testes. Não há resolução de CAPTCHA, alteração de fingerprint ou automação de navegador no provider.

`offerUrl` permanece `null`, pois os identificadores individuais das ofertas são efêmeros. A validação manual usa apenas `searchUrl`.

As diárias são consultadas em lotes de no máximo três por busca, mantendo o
limite total de 20 segundos. Cada diária trata a própria falha e preserva as
demais já concluídas. Todas as requisições do lote terminam antes de avançar;
o sinal é abortado e o timer removido no `finally`. Status de disponibilidade
desconhecido e preço base zero são erros técnicos, não indisponibilidade.

## Deploy e reaproveitamento

Não há nova variável de ambiente ou segredo. Na Vercel, os riscos são rate limiting, bloqueio de IP de saída, mudança do GraphQL, mudança na configuração pública ou alteração dos textos de impostos. A chave pública é descoberta novamente a cada pesquisa, reduzindo o impacto de rotação.

A estratégia pode ser reutilizada para outros hotéis ALL/Accor trocando o código público do hotel e mantendo validações específicas de moeda, mercado, impostos e ocupação.
