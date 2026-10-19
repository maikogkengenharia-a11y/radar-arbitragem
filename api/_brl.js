// Corretoras com o par USDT/BRL (dólar digital contra real).
// Só dados públicos: nada aqui usa chave de API nem faz ordens.
import { j } from "./_corretoras.js";

export const BRL = {
  binance: "Binance", bitget: "Bitget", bybit: "Bybit", kucoin: "KuCoin",
  mercadobitcoin: "Mercado Bitcoin", bitso: "Bitso", novadax: "NovaDAX", foxbit: "Foxbit",
};

const n = v => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : null; };
const par = l => (l || []).map(x => Array.isArray(x) ? [n(x[0]), n(x[1])] : [n(x.price), n(x.amount ?? x.quantity)])
  .filter(([p, q]) => p && q);

async function binance(caminho) {
  try { return await j(`https://data-api.binance.vision/api/v3/${caminho}`); }
  catch { return await j(`https://api.binance.com/api/v3/${caminho}`); }
}

// Livro de ofertas de USDT/BRL: { asks: [[preço, qtd]...], bids: [...] }
export const LIVRO_BRL = {
  binance: async () => { const d = await binance("depth?symbol=USDTBRL&limit=50"); return [d.asks, d.bids]; },
  bitget: async () => { const d = await j("https://api.bitget.com/api/v2/spot/market/orderbook?symbol=USDTBRL&type=step0&limit=50"); return [d.data?.asks, d.data?.bids]; },
  bybit: async () => { const d = await j("https://api.bybit.com/v5/market/orderbook?category=spot&symbol=USDTBRL&limit=50"); return [d.result?.a, d.result?.b]; },
  kucoin: async () => { const d = await j("https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=USDT-BRL"); return [d.data?.asks, d.data?.bids]; },
  mercadobitcoin: async () => {
    try { const d = await j("https://api.mercadobitcoin.net/api/v4/USDT-BRL/orderbook?limit=50"); return [d.asks, d.bids]; }
    catch { const d = await j("https://www.mercadobitcoin.net/api/USDT/orderbook/"); return [d.asks, d.bids]; }
  },
  bitso: async () => { const d = await j("https://api.bitso.com/v3/order_book/?book=usdt_brl&aggregate=true"); return [d.payload?.asks, d.payload?.bids]; },
  novadax: async () => { const d = await j("https://api.novadax.com/v1/market/depth?symbol=USDT_BRL&limit=50"); return [d.data?.asks, d.data?.bids]; },
  foxbit: async () => { const d = await j("https://api.foxbit.com.br/rest/v3/markets/usdtbrl/orderbook?depth=50"); return [d.asks, d.bids]; },
};

export async function livroBrl(c) {
  const [a, b] = await LIVRO_BRL[c]();
  const asks = par(a).sort((x, y) => x[0] - y[0]);
  const bids = par(b).sort((x, y) => y[0] - x[0]);
  if (!asks.length || !bids.length) throw new Error("sem ofertas de USDT/BRL no momento");
  // proteção contra dado estranho: venda nunca pode ser muito maior que compra
  if (bids[0][0] > asks[0][0] * 1.05) throw new Error("livro de ofertas inconsistente");
  return { asks, bids };
}
