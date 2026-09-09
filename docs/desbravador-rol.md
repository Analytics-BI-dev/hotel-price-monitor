# Integração com o Desbravador ROL

> Documento histórico. A coleta automática descrita abaixo não faz mais parte
> da aplicação. Hotel Alles Blau, Jacques Georges Tower e M Tower Hotel agora
> usam somente links externos gerados localmente, sem API ou navegador.

## Conclusão de segurança

O motor público do Hotel Alles Blau é uma SPA e exibe reCAPTCHA antes de mostrar a etapa de acomodações e tarifas. O JavaScript carregado pela própria página define uma interface JSON separada para quartos, disponibilidade e tarifas. Nenhuma das três operações inclui token ou resposta de CAPTCHA no payload.

O endpoint exige autenticação HTTP própria do Desbravador. Portanto, o acesso direto só é apropriado com credenciais de integração fornecidas oficialmente e autorização do hotel/Desbravador. O provider nunca coleta ou reutiliza credenciais encontradas no bundle público, cookies da página, tokens de sessão ou tokens de CAPTCHA.

Não foi localizada documentação pública do contrato específico abaixo. A documentação pública da Desbravador informa que o produto Reservas Online atualiza tarifas e disponibilidade em tempo real, que a empresa oferece integrações por API e que há um fluxo formal de solicitação de integrações no suporte. Até haver confirmação formal, esta interface deve ser considerada interna e sujeita a mudanças.

## Endpoint observado

- URL: `https://reservas.desbravador.com.br/reservas/modules/ws/interface.php`
- Método: `POST`
- `Content-Type`: `application/json`
- `Accept`: `application/json`
- Autorização: `Authorization: Basic <credencial oficial server-side>`
- Cookies de navegador: não são necessários
- Token de sessão do navegador: não é necessário
- Token de reCAPTCHA: não é enviado
- Cache: desabilitado no provider

Sem autenticação válida, a interface recusa a operação. As credenciais ficam somente em `DESBRAVADOR_API_USERNAME` e `DESBRAVADOR_API_PASSWORD`, sem prefixo `NEXT_PUBLIC_`.

## Operações JSON

Todas as operações usam o mesmo endpoint e identificam o hotel pelo `slug`. As datas da API usam `DD/MM/AAAA`.

### Tarifas e preços

```json
{
  "wsrolRQ": {
    "hotelLoginRQ": {
      "slug": "hotel-alles-blau",
      "origem": "rolweb",
      "ip": ""
    },
    "tarifasRQ": {
      "tarifas": {
        "datainicio": "DD/MM/AAAA",
        "datafim": "DD/MM/AAAA",
        "detalhes": true,
        "cdpessoa": 0,
        "cdpessoalog": 0,
        "cdvoucher": 0,
        "fgaplicacao": 0
      }
    }
  }
}
```

Campos usados na resposta:

- descrição e metadados da tarifa: `wsrolRS.tarifasRS.tarifas.info[rateCode]`
- café da manhã: `...info[rateCode].cafe`
- política reembolsável: `...info[rateCode].reembolso`
- moeda: `...info[rateCode].nmmoeda`
- preço por ocupação: `wsrolRS.tarifasRS.tarifas.valores[roomCode][rateCode][DD/MM/AAAA].perocc[adults]`
- venda fechada: `...valores[roomCode][rateCode][date].closed`
- mínimo e máximo de noites: `...minlos` e `...maxlos`

### Acomodações

```json
{
  "wsrolRQ": {
    "hotelLoginRQ": {
      "slug": "hotel-alles-blau",
      "origem": "rolweb",
      "ip": ""
    },
    "hotelInfoRQ": {
      "parametros": false,
      "profissoes": false,
      "hotelInfo": false,
      "politicas": false,
      "quartos": true
    }
  }
}
```

Campos usados na resposta:

- código da acomodação: `wsrolRS.hotelInfoRS.quartos[*].codigo`
- nome da acomodação: `wsrolRS.hotelInfoRS.quartos[*].descricao.portugues`

### Disponibilidade

```json
{
  "wsrolRQ": {
    "hotelLoginRQ": {
      "slug": "hotel-alles-blau",
      "origem": "rolweb",
      "ip": ""
    },
    "disponibilidadeRQ": {
      "disponibilidade": {
        "datainicio": "DD/MM/AAAA",
        "datafim": "DD/MM/AAAA",
        "detalhes": true,
        "cdvoucher": 0
      }
    }
  }
}
```

Campos usados na resposta:

- disponibilidade mínima por acomodação: `wsrolRS.disponibilidadeRS.disponibilidade.result[roomCode].minimo`
- detalhe diário: `wsrolRS.disponibilidadeRS.disponibilidade.result[roomCode].diaria[DD/MM/AAAA]`

O provider só aceita a acomodação quando `minimo > 0`, a tarifa não está fechada, respeita `minlos`/`maxlos` e há preço para a ocupação solicitada.

## Relação com o reCAPTCHA

O bundle da aplicação conhece as operações acima antes de qualquer interação com o desafio, e os payloads de dados não carregam valor de reCAPTCHA. A interface visual, contudo, impede o usuário de avançar até as ofertas enquanto o desafio não for concluído. Em teste técnico server-side, a API devolveu dados sem cookies e sem CAPTCHA quando recebeu uma credencial HTTP válida; isso não autoriza o reaproveitamento de credenciais públicas ou internas.

## Reutilização e fallback

O contrato aparenta ser multi-hotel porque usa `hotelLoginRQ.slug`. Ele pode servir de base para outros hotéis Desbravador somente após validação do schema de cada hotel e autorização formal para cada integração.

Quando faltam credenciais oficiais ou a autorização é recusada, o resultado normalizado é:

```json
{
  "status": "manual_verification_required",
  "searchUrl": "https://reservas.desbravador.com.br/hotel-app/...",
  "manualVerification": {
    "mode": "human_in_the_loop",
    "reason": "provider_credentials_required"
  }
}
```

Esse contrato prepara uma futura implementação em que um administrador abre uma sessão de navegador e resolve o CAPTCHA manualmente. A sessão humana, a persistência de cookies e qualquer retomada de coleta não estão implementadas nesta fase.
