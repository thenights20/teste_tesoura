# Bunkr Viewer

Visualizador pessoal para organizar e reproduzir, em uma interface limpa, mídias que estejam publicamente expostas por páginas do `bunkr.cr`.

## O que esta versão faz

- aceita links `https://bunkr.cr/f/...` e `https://bunkr.cr/a/...`;
- lê a página pública no servidor;
- procura URLs de vídeo/imagem expostas no HTML inicial;
- monta playlist com anterior/próximo;
- avança automaticamente ao terminar um vídeo;
- guarda até 12 links recentes somente no `localStorage` do navegador;
- funciona em desktop e celular;
- não carrega os scripts nem os anúncios da página original.

## Limites intencionais

O projeto **não** faz login no Bunkr, não resolve CAPTCHA, não fabrica/renova tokens, não contorna anti-hotlink e não atua como proxy de streaming. Se uma mídia só puder ser reproduzida mediante proteção/restrição específica do host, ela será deixada de fora ou poderá falhar no player.

A função `/api/extract` aceita somente `https://bunkr.cr`, evitando transformar o endpoint em um proxy HTTP genérico.

## Estrutura

```text
public/
  index.html       interface
  styles.css       visual responsivo
  app.js           player, playlist e histórico
functions/
  api/
    extract.js     Cloudflare Pages Function
```

## Publicação recomendada: Cloudflare Pages

1. No Cloudflare Dashboard, abra **Workers & Pages** > **Create** > **Pages** > **Connect to Git**.
2. Conecte o repositório `thenights20/bunkr.cr`.
3. Em configurações de build, use:
   - Framework preset: `None`;
   - Build command: deixe vazio;
   - Build output directory: `public`.
4. Faça o deploy.

A pasta `functions/` é detectada pelo Cloudflare Pages e disponibiliza automaticamente `/api/extract`.

> GitHub Pages sozinho não executa a função server-side de extração. O GitHub continua sendo o repositório; o Cloudflare Pages hospeda a aplicação e a função.

## Desenvolvimento local

Com Node.js instalado:

```bash
npx wrangler pages dev public
```

Depois abra o endereço local informado pelo Wrangler e cole um link público do Bunkr.

## Próximos aprimoramentos possíveis

- melhorar o parser conforme exemplos reais de links que não forem reconhecidos;
- miniaturas mais completas quando estiverem publicamente disponíveis;
- filtros para exibir somente vídeos ou imagens;
- busca dentro de álbuns grandes;
- retomada da posição do último vídeo assistido;
- modo teatro e atalhos de teclado.
