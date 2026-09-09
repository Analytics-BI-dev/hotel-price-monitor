# Coleta do site oficial do Curi Palace Hotel

## Motor e URLs

O site `https://www.curipalacehotel.com.br/` usa o motor **HBook**, da **HSystem**. O formulário e os botões de reserva abrem:

```text
https://hbook.hsystem.com.br/booking?companyId=61607dad584d1d88bb3eb28f
```

A pesquisa equivalente usa:

- `checkin=DD/MM/AAAA`
- `checkout=DD/MM/AAAA`
- `adults=1` ou `adults=2`
- `children=0`

O motor trabalha com a seleção de uma acomodação; não há parâmetro separado de quantidade de quartos na pesquisa inicial. O provider representa sempre uma acomodação e não adiciona crianças.

## Endpoint de disponibilidade

A página pública fornece um `availabilityToken` efêmero e um array público `rateTypes` com metadados das tarifas. Em seguida, o próprio HBook usa:

```text
POST https://hbook.hsystem.com.br/Booking/GetAvailability
Accept: application/json
Content-Type: application/json; charset=utf-8
```

Payload observado:

```json
{
  "CompanyId": "61607dad584d1d88bb3eb28f",
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

Não são necessários login, `Authorization`, cookies persistentes ou token de CAPTCHA. O token de disponibilidade fica somente na memória do servidor, não é registrado e não é exposto ao cliente.

## Resposta e normalização

A resposta é JSON. O provider utiliza:

- `HasErrors` e `ValidationErrors` para erros;
- `Rooms[]` para acomodações;
- `RoomTypeName` para o nome;
- `Availability` para a quantidade disponível;
- `Rates[]` para preservar todas as tarifas do quarto;
- `RateTypeId` e `RateTypeName` para identificar a tarifa;
- `PerDayRates[].Date` e `PerDayRates[].Rate` para preços diários;
- `TotalValue` ou `DailyPrice` somente como fallback de uma diária.

O array `rateTypes` do HTML informa `MealPlanView`, `ExtraProducts` e `PaymentPolicy.IsNonRefundable`. Esses campos alimentam `breakfastIncluded` e `refundable`; quando ausentes, o valor normalizado é `null`.

Cada combinação válida de quarto e tarifa vira uma `offer`. As ofertas são ordenadas por preço e `bestPrice` é a menor tarifa válida, independentemente de categoria, café ou reembolso.

## CAPTCHA, erros e disponibilidade

O HBook inclui reCAPTCHA na finalização da reserva. A consulta de disponibilidade funcionou sem resolver CAPTCHA e não recebe `captchaResponse`. Não foi implementado bypass, alteração de fingerprint ou automação de navegador.

- resposta válida sem quartos ou tarifas: `unavailable`;
- timeout, falha HTTP, schema inesperado ou erro de parsing: `error`;
- desafio CAPTCHA explícito impedindo a consulta: `manual_verification_required`.

## Reaproveitamento e deploy

O Curi Palace usa o mesmo contrato HBook já validado no Curi Executive. A estratégia, o transporte e as regras de normalização podem ser reutilizados por outros hotéis HBook, enquanto identificador, URL, logs e registry permanecem próprios. O provider do Curi Executive não foi modificado.

O HBook devolve cabeçalhos maiores que o limite padrão do `fetch` do Node. A
coleta usa o transporte compartilhado `hbook-transport.ts`: HTTPS nativo
server-side, limite explícito de cabeçalhos e corpo (16 MiB), sem persistir
cookies, identificação transparente `HotelPriceMonitor/1.0` e aborto por sinal.
Disponibilidade ausente ou inválida é erro de schema; café explicitamente não
incluído não é confundido com café incluso.

Não há nova variável de ambiente ou segredo. Na Vercel, os riscos operacionais são mudança no HTML/token, alteração do JSON, rate limit ou bloqueio dos IPs de saída. Essas situações são tratadas como erro técnico, nunca como falsa indisponibilidade.
