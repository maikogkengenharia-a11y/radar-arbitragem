// GET /api/monitor  -> uma linha por moeda: onde comprar mais barato, onde vender mais caro, diferença e volume 24h
// Lê a lista completa de preços de 7 corretoras (dados públicos) + o USDT/BRL das corretoras brasileiras.
import { j, erroCurto } from "./_corretoras.js";
import { livroBrl } from "./_brl.js";

const num = v => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : 0; };
const base = (s, suf) => s && s.endsWith(suf) ? s.slice(0, -suf.length) : null;

async function binance() {
  let d;
  try { d = await j("https://data-api.binance.vision/api/v3/ticker/24hr"); }
  catch { d = await j("https://api.binance.com/api/v3/ticker/24hr"); }
  return d.map(x => [x.symbol, base(x.symbol, "USDT"), x.bidPrice, x.askPrice, x.quoteVolume]);
}
const FONTES = {
  binance,
  bybit: async () => ((await j("https://api.bybit.com/v5/market/tickers?category=spot")).result?.list || [])
    .map(x => [x.symbol, base(x.symbol, "USDT"), x.bid1Price, x.ask1Price, x.turnover24h]),
  okx: async () => ((await j("https://www.okx.com/api/v5/market/tickers?instType=SPOT")).data || [])
    .map(x => [x.instId, base(x.instId, "-USDT"), x.bidPx, x.askPx, x.volCcy24h]),
  bitget: async () => ((await j("https://api.bitget.com/api/v2/spot/market/tickers")).data || [])
    .map(x => [x.symbol, base(x.symbol, "USDT"), x.bidPr, x.askPr, x.quoteVolume]),
  kucoin: async () => ((await j("https://api.kucoin.com/api/v1/market/allTickers")).data?.ticker || [])
    .map(x => [x.symbol, base(x.symbol, "-USDT"), x.buy, x.sell, x.volValue]),
  mexc: async () => (await j("https://api.mexc.com/api/v3/ticker/24hr") || [])
    .map(x => [x.symbol, base(x.symbol, "USDT"), x.bidPrice, x.askPrice, x.quoteVolume]),
  gate: async () => (await j("https://api.gateio.ws/api/v4/spot/tickers") || [])
    .map(x => [x.currency_pair, base(x.currency_pair, "_USDT"), x.highest_bid, x.lowest_ask, x.quote_volume]),
};
const BRL_CEX = ["binance", "bitget", "bybit", "okx", "mercadobitcoin", "bitso", "foxbit", "mexc", "kucoin"];

let cache = { t: 0, v: null };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=10");
  if (cache.v && Date.now() - cache.t < 12000) return res.status(200).json(cache.v);

  const porMoeda = {}, erros = {};
  let usdBrl = 0;
  await Promise.all(Object.entries(FONTES).map(async ([c, f]) => {
    try {
      for (const [sym, m, b, a, v] of await f()) {
        if (c === "binance" && sym === "USDTBRL") usdBrl = (num(b) + num(a)) / 2;
        if (!m || !/^[A-Z0-9]{2,12}$/.test(m)) continue;
        const bid = num(b), ask = num(a), vol = num(v);
        if (!bid || !ask || ask < bid * 0.98 || vol < 20000) continue; // ignora mercado parado ou sem oferta
        (porMoeda[m] = porMoeda[m] || {})[c] = { bid, ask, vol };
      }
    } catch (e) { erros[c] = erroCurto(e); }
  }));
  if (!usdBrl) usdBrl = 5.3;

  const linhas = [];
  for (const [m, ex] of Object.entries(porMoeda)) {
    const cs = Object.keys(ex);
    if (cs.length < 2 || ["USDC", "FDUSD", "TUSD", "DAI", "USDE", "USD1", "BUSD"].includes(m)) continue;
    let compra = null, venda = null;
    for (const c of cs) {
      if (!compra || ex[c].ask < ex[compra].ask) compra = c;
      if (!venda || ex[c].bid > ex[venda].bid) venda = c;
    }
    if (compra === venda) continue;
    const spread = (ex[venda].bid / ex[compra].ask - 1) * 100;
    if (spread <= 0 || spread > 12) continue; // acima disso quase sempre é moeda diferente com o mesmo nome ou saque fechado
    linhas.push({
      moeda: m, mercado: "USDT", compra: { c: compra, p: ex[compra].ask }, venda: { c: venda, p: ex[venda].bid },
      spread: +spread.toFixed(3), vol: Math.round(cs.reduce((t, c) => t + ex[c].vol, 0) * usdBrl), exs: cs,
    });
  }
  // USDT/BRL entre as corretoras brasileiras
  const brl = {};
  await Promise.all(BRL_CEX.map(async c => { try { const l = await livroBrl(c); brl[c] = { bid: l.bids[0][0], ask: l.asks[0][0] }; } catch {} }));
  const cb = Object.keys(brl);
  if (cb.length >= 2) {
    const compra = cb.reduce((x, y) => brl[y].ask < brl[x].ask ? y : x), venda = cb.reduce((x, y) => brl[y].bid > brl[x].bid ? y : x);
    if (compra !== venda) linhas.push({
      moeda: "USDT", mercado: "BRL", compra: { c: compra, p: brl[compra].ask }, venda: { c: venda, p: brl[venda].bid },
      spread: +((brl[venda].bid / brl[compra].ask - 1) * 100).toFixed(3), vol: 0, exs: cb,
    });
  }
  linhas.sort((x, y) => y.spread - x.spread);
  cache = { t: Date.now(), v: { t: Date.now(), moedas: Object.keys(porMoeda).length, usdBrl, linhas: linhas.slice(0, 400), erros } };
  res.status(200).json(cache.v);
}
