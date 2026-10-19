# Mesa de Arbitragem (simulador)

Simulador de arbitragem de USDT/BRL entre corretoras brasileiras e internacionais, com preços reais ao vivo e dinheiro virtual.

- `index.html` — a mesa: cotações, oportunidades com execução passo a passo, robô automático, performance, histórico, impostos e configurações (tudo salvo no navegador)
- `radar.html` — radar de diferenças de outras moedas (BTC, ETH, SOL…) contra USDT
- `api/brl.js` — livro de ofertas de USDT/BRL em Binance, Bitget, Bybit, KuCoin, Mercado Bitcoin, Bitso, NovaDAX e Foxbit
- `api/precos.js`, `api/livro.js` — dados do radar de moedas
- `vercel.json` — funções no servidor de São Paulo (`gru1`)

Só lê dados públicos. Não usa chave de API, não faz ordens e não move dinheiro. Não é recomendação de investimento.
