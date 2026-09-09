# Coleta do site oficial do Hotel Curi Executive

## Motor e fluxo

O site `https://www.hotelcuri.com.br/` usa o motor **HBook**, da **HSystem**. O formulário executa `BookInline` e abre:

```text
https://hbook.hsystem.com.br/booking
```

Parâmetros da pesquisa:

- `companyId=617028bb0228061225bd735e`
- `checkin=DD/MM/AAAA`
- `checkout=DD/MM/AAAA`
- `adults=1` ou `adults=2`
- `children=0`

O `searchUrl` do provider usa exatamente esse formato e pode ser aberto manualmente no card.

## Estratégia de coleta

A página inicial do HBook entrega um campo oculto `availabilityToken` e os metadados públicos das tarifas. O token é efêmero, nunca é registrado em log, persistido ou enviado ao navegador da aplicação.

Em seguida, o próprio HBook consulta:

```text
POST https://hbook.hsystem.com.br/Booking/GetAvailability
Content-Type: application/json; charset=utf-8
Accept: application/json
```

Payload observado:

```json
{
  "CompanyId": "617028bb0228061225bd735e",
  "ArrivalDateString": "DD/MM/AAAA",
  "DepartureDateString": "DD/MM/AAAA",
  "PromotionalCode": "",
  "AmountAdults": 1,
  "AmountChildren": 0,
  "ChildrenAges": [],
  "IsReturningAbandonedBooking": false,
  "IsReturningBudgetBooking": false,
  "Language": "pt-BR",
  "AvailabilityToken": "<token efêmero obtido no GET>"
}
```

Não são necessários login, `Authorization` ou cookies. A investigação e os testes automatizados confirmam que nenhum cookie, token de sessão ou token de CAPTCHA é enviado à disponibilidade.

## Resposta utilizada

A resposta é JSON. Os campos principais são:

- erros: `HasErrors` e `ValidationErrors`
- acomodações: `Rooms[]`
- nome: `Rooms[].RoomTypeName`
- quantidade disponível: `Rooms[].Availability`
- tarifas: `Rooms[].Rates[]`
- identificação da tarifa: `Rooms[].Rates[].RateTypeId` e `RateTypeName`
- total da estadia: `Rooms[].Rates[].TotalValue`
- preço diário: `Rooms[].Rates[].PerDayRates[].Rate`
- data do preço: `Rooms[].Rates[].PerDayRates[].Date`

Os metadados de tarifa vêm do array público `rateTypes` no HTML:

- café da manhã: `MealPlanView` e `ExtraProducts[].Name`
- reembolso: inverso de `PaymentPolicy.IsNonRefundable`
- política de cancelamento: `PaymentPolicy.CancellationPolicy.Description`

Quando um campo opcional não estiver presente, o provider retorna `null` em vez de inferir informação.

## Disponibilidade, erro e CAPTCHA

- resposta válida com `Rooms=[]`: `status="unavailable"`
- timeout, HTTP inválido, JSON inesperado ou falha de parsing: `status="error"`
- desafio CAPTCHA explícito bloqueando a consulta: `status="manual_verification_required"`

O HBook carrega scripts de reCAPTCHA porque o CAPTCHA é usado na finalização da reserva (`ProcessBooking`). A operação de disponibilidade não recebe `captchaResponse` e funcionou sem resolver ou contornar CAPTCHA. O provider não efetua reserva e não implementa Playwright.

## Normalização

Cada combinação de quarto e tarifa disponível vira uma `offer`. Para pesquisas com várias diárias, o provider usa o valor real de cada item de `PerDayRates`. As ofertas de cada dia são ordenadas por preço e `bestPrice` recebe o primeiro valor.

O Trivago do Curi Executive usa o provider real genérico, registrado separadamente do site oficial.

Disponibilidade ausente ou inválida é erro de schema e não autoriza retornar
preços. A indicação explícita de café não incluído tem prioridade sobre a
palavra genérica “café” no metadado.

## Deploy

O HBook envia um cabeçalho HTTP maior que o limite padrão do `fetch` do Node. Por isso, o provider usa o cliente HTTPS nativo server-side com `maxHeaderSize` explícito, sem persistir cookies, e se identifica de forma transparente como `HotelPriceMonitor/1.0`. Isso não imita navegador nem altera fingerprint.

O transporte HTTPS é compartilhado com o Curi Palace em `hbook-transport.ts`,
com limite de corpo de 16 MiB, aborto por sinal e tratamento de respostas sem
corpo ou interrompidas. Não há segredo nem variável de ambiente adicional. O
risco operacional para a Vercel é o HBook alterar o HTML que entrega
`availabilityToken`, o schema JSON ou bloquear requisições originadas dos IPs
da Vercel; qualquer uma dessas situações vira erro técnico, nunca
indisponibilidade falsa.
