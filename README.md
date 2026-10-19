# Radar de Arbitragem

Painel que compara ao vivo o preço de criptomoedas em 9 corretoras (Binance, Bitget, Bybit, KuCoin, Gate.io, MEXC, OKX, BingX, CoinEx), já descontando taxas, com valores em reais.

- `index.html` — o painel (sinais, simulador, operações em andamento)
- `api/precos.js` — lê o melhor preço de compra e venda em cada corretora + cotação do dólar
- `api/livro.js` — lê o livro de ofertas para o simulador
- `vercel.json` — roda as funções no servidor de São Paulo (`gru1`), porque Binance, Bybit e OKX bloqueiam servidores dos EUA

Só lê preços públicos. Não usa chave de API e não faz ordens. Não é recomendação de investimento.
