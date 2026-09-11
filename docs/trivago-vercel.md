# Trivago na Vercel: JSON diário

Cadastre `TRIVAGO_JSON_URL` em **Settings > Environment Variables** no ambiente
correto, como variável exclusiva do servidor. Use uma URL HTTP(S) de conteúdo
JSON direto, sem login. Nunca versione o valor ou use `NEXT_PUBLIC_`.

O dashboard continua em Node.js, com Node 24.x e `maxDuration = 300` para as
consultas aos sites oficiais. O Trivago usa um download com timeout de 15
segundos por busca. Não há pacote de browser, binário Chromium, extração em
`/tmp`, instalação no build ou worker de coleta live na função.

A antiga configuração `TRIVAGO_MAX_CONCURRENCY` pode ser excluída do ambiente.
As regras de tracing e externalização usadas para browsers foram removidas.
Playwright só é utilizado pelo teste visual local, como dependência de
desenvolvimento, e não é importado pela aplicação.

Atualizar o JSON externamente na mesma URL não exige nova publicação ou
restart: a próxima ação “Buscar preços” faz uma nova leitura com `no-store`.
O cadastro inicial de uma variável de ambiente deve seguir o fluxo normal
de configuração/publicação da hospedagem.

## Conferência após publicar

1. Pesquise uma data coberta pelo arquivo com 1 ou 2 adultos.
2. Confirme um `TRIVAGO_JSON_FETCH_SUCCESS` por busca e os
   `TRIVAGO_JSON_LOOKUP` por hotel/data.
3. Confirme os preços/provedores e o botão de pesquisa manual.
4. Pesquise uma data sem cobertura: Trivago deve ficar indisponível e os
   sites oficiais continuam independentes.
5. Atualize o arquivo e repita a busca: os novos valores devem aparecer.

`TRIVAGO_JSON_ERROR` informa se falta a variável, se o HTTP falhou, se houve
timeout, se o conteúdo é HTML ou se o JSON é inválido. Uma página HTML do
OneDrive exige trocar para uma URL de download/conteúdo direto. A mensagem
não expõe a URL nem tokens. Não há fallback para scraping.

Consulte [o contrato e a auditoria](trivago-json.md).
