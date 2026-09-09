# Coleta do site oficial do M Tower Hotel

> Documento histórico. A coleta automática do site oficial e o fallback de
> navegador foram removidos. O M Tower agora usa somente a URL externa da
> pesquisa, gerada localmente com datas e ocupação.

## Motor e URL de pesquisa

O botão `Reservas` de `https://www.mtowerhotel.com.br/` abre o produto **Reservas Online**, da Desbravador, no domínio `reservas.desbravador.com.br`. O hotel usa o slug público `m-tower-hotel`.

```text
https://reservas.desbravador.com.br/hotel-app/m-tower-hotel/reservation
  ?checkin=AAAA-MM-DD
  &checkout=AAAA-MM-DD
  &adults=1|2
  &child1=0
  &child2=0
  &child3=0
  &voucher=
  &resident=0
```

A composição é fixa em um quarto e zero crianças. O motor preserva as datas e os adultos na URL, mas exige reCAPTCHA antes de exibir acomodações e tarifas.

## Interface JSON observada

O JavaScript público do motor usa uma interface JSON separada:

```text
POST https://reservas.desbravador.com.br/reservas/modules/ws/interface.php
Accept: application/json
Content-Type: application/json
Authorization: Basic <credencial oficial de integração>
```

O endpoint responde HTTP 200 mesmo quando recusa a operação; nesses casos, `wsrolRS.status.resultado=0` e o código interno pode ser `403`. Uma consulta anônima feita para o M Tower foi recusada dessa forma.

O provider não extrai nem reutiliza credenciais do bundle público. A implementação ativa agora é a classe compartilhada `DesbravadorOfficialProvider`. Ela aceita `M_TOWER_DESBRAVADOR_API_USERNAME` e `M_TOWER_DESBRAVADOR_API_PASSWORD` somente quando fornecidas oficialmente e configuradas server-side; sem elas, inicia o fluxo human-in-the-loop isolado descrito em `docs/desbravador-human-verification.md`. Cookies e tokens de reCAPTCHA não são copiados nem repetidos pelo provider.

## Operações

Todas identificam o hotel com:

```json
{
  "hotelLoginRQ": {
    "slug": "m-tower-hotel",
    "origem": "rolweb",
    "ip": ""
  }
}
```

O provider envia três operações em paralelo:

- `tarifasRQ.tarifas`: datas `DD/MM/AAAA`, detalhes e parâmetros públicos de tarifa;
- `hotelInfoRQ`: solicita somente quartos;
- `disponibilidadeRQ.disponibilidade`: datas, detalhes e voucher zero.

Campos normalizados:

- quarto: `hotelInfoRS.quartos[*].codigo` e `descricao.portugues`;
- disponibilidade: `disponibilidadeRS.disponibilidade.result[roomCode].minimo`;
- tarifa: `tarifasRS.tarifas.info[rateCode]`;
- preço diário por ocupação: `tarifasRS.tarifas.valores[roomCode][rateCode][DD/MM/AAAA].perocc[adults]`;
- restrições: `closed`, `minlos` e `maxlos`;
- café: `info[rateCode].cafe`;
- reembolso: `info[rateCode].reembolso`.

## Preço diário e taxas

`perocc[adults]` é o preço daquela data para a ocupação selecionada. Em uma estadia com várias noites, o provider lê cada chave `DD/MM/AAAA` separadamente; ele não divide o total da estadia nem calcula média.

Não foi identificado um campo separado de imposto ou taxa obrigatória nessa resposta. O provider usa o valor de venda diário de `perocc`, sem acrescentar estacionamento, garagem ou outros serviços opcionais. Se a estrutura esperada desaparecer, o resultado é `error`, não `unavailable`.

Tarifas diferentes do mesmo quarto são preservadas pelo par `roomCode + rateCode`. `offerUrl` é `null`, pois não há URL estável de uma oferta individual.

## CAPTCHA, fallback e segurança

O reCAPTCHA bloqueia a interface de ofertas. Ele não é resolvido nem contornado. A API também exige autenticação HTTP própria, e a credencial não está configurada no ambiente atual.

- sem credencial oficial: `manual_verification_required` com `provider_credentials_required`;
- credencial recusada: `manual_verification_required` com `provider_authorization_required`;
- desafio anti-bot explícito: `manual_verification_required` com `captcha_required`;
- resposta válida sem disponibilidade: `unavailable`;
- HTTP, timeout, JSON inválido ou schema alterado: `error`.

Em todos os fallbacks, `searchUrl` é preservada para consulta humana. Nenhuma senha, credencial, cookie ou header de autorização é registrada.

## Deploy e reaproveitamento

Na Vercel, as credenciais oficiais devem existir somente como variáveis server-side, sem prefixo `NEXT_PUBLIC_`. Os principais riscos são expiração ou escopo insuficiente da credencial, mudança do contrato interno, rate limiting, bloqueio de IP e alteração do reCAPTCHA.

O contrato aparenta ser multi-hotel pelo uso de `hotelLoginRQ.slug`, mas cada novo hotel precisa de autorização formal, confirmação do slug e validação do schema e das regras tarifárias.
