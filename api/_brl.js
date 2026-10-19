// Corretoras com o par USDT/BRL (dólar digital contra real).
// Só dados públicos: nada aqui usa chave de API nem faz ordens.
import { j } from "./_corretoras.js";

export const BRL = {
  binance: "Binance", bitget: "Bitget", bybit: "Bybit", kucoin: "KuCoin",
  mercadobitcoin: "Mercado Bitcoin", bitso: "Bitso", novadax: "NovaDAX", foxbit: "Foxbit", mexc: "MEXC",
  // saída por DEX: USDT → BRLA na KyberSwap (Polygon) e BRLA → reais via Pix nestes apps
  avenia: "Avenia", chainless: "Chainless", picnic: "Picnic",
};

// ---------- KyberSwap (Polygon): preço de USDT ↔ BRLA para alguns tamanhos de ordem
const USDT_POLYGON = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // 6 casas
const BRLA_POLYGON = "0xE6A537a407488807F0bbeb0038B79004f19DDDFb"; // 18 casas, 1 BRLA = 1 real
const TAM_USDT = [100, 1000, 5000, 20000];
const TAM_BRLA = [500, 5000, 25000, 100000];
let cacheKyber = { t: 0, p: null };

async function kyber(tokenIn, tokenOut, amountWei) {
  const r = await fetch(`https://aggregator-api.kyberswap.com/polygon/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountWei}`, {
    headers: { "X-Client-Id": "mesa-arbitragem", Accept: "application/json" }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`KyberSwap respondeu ${r.status}`);
  const d = await r.json();
  const out = d?.data?.routeSummary?.amountOut;
  if (!out) throw new Error("KyberSwap sem rota USDT/BRLA");
  return BigInt(out);
}
// transforma cotações por tamanho em "níveis" de livro de ofertas
function niveis(pares) {
  const out = []; let pi = 0, po = 0;
  for (const [i, o] of pares) { if (o > po && i > pi) out.push([(o - po) / (i - pi), i - pi]); pi = i; po = o; }
  return out;
}
async function livroKyber() {
  if (Date.now() - cacheKyber.t < 8000 && cacheKyber.p) return cacheKyber.p;
  cacheKyber = { t: Date.now(), p: (async () => {
    const vendas = await Promise.all(TAM_USDT.map(async u => [u, Number(await kyber(USDT_POLYGON, BRLA_POLYGON, BigInt(u) * 10n ** 6n)) / 1e18]));
    const compras = await Promise.all(TAM_BRLA.map(async b => [b, Number(await kyber(BRLA_POLYGON, USDT_POLYGON, BigInt(b) * 10n ** 18n)) / 1e6]));
    // bids: vender USDT, receber BRLA (preço = BRLA por USDT)
    const bids = niveis(vendas).map(([p, q]) => [p, q]);
    // asks: pagar BRLA, receber USDT (preço = BRLA por USDT, quantidade em USDT)
    const asks = niveis(compras.map(([b, u]) => [u, b])).map(([p, q]) => [p, q]);
    return [asks, bids];
  })() };
  try { return await cacheKyber.p; } catch (e) { cacheKyber = { t: 0, p: null }; throw e; }
}

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
  mexc: async () => { const d = await j("https://api.mexc.com/api/v3/depth?symbol=USDTBRL&limit=50"); return [d.asks, d.bids]; },
  avenia: livroKyber, chainless: livroKyber, picnic: livroKyber,
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
