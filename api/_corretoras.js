// Leitura dos preços públicos de cada corretora, direto pelas APIs oficiais.
// Nada aqui usa chave de API nem faz ordens.

export const NOMES = {
  binance: "Binance", bitget: "Bitget", bybit: "Bybit", kucoin: "KuCoin",
  gate: "Gate.io", mexc: "MEXC", okx: "OKX", bingx: "BingX", coinex: "CoinEx",
};

export async function j(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (radar-arbitragem)", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`a corretora respondeu ${r.status}`);
  return r.json();
}

// Nome do par moeda/USDT em cada corretora
export const PAR = {
  binance: m => `${m}USDT`, bybit: m => `${m}USDT`, okx: m => `${m}-USDT`,
  bitget: m => `${m}USDT`, kucoin: m => `${m}-USDT`, gate: m => `${m}_USDT`,
  mexc: m => `${m}USDT`, bingx: m => `${m}-USDT`, coinex: m => `${m}USDT`,
};

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Monta {par: {bid, ask}} a partir de uma lista
function mapa(lista, f) {
  const out = {};
  for (const x of lista || []) {
    const [s, b, a] = f(x);
    const bid = num(b), ask = num(a);
    if (s && bid && ask) out[s] = { bid, ask };
  }
  return out;
}

async function binanceTickers() {
  let d;
  try { d = await j("https://data-api.binance.vision/api/v3/ticker/bookTicker"); }
  catch { d = await j("https://api.binance.com/api/v3/ticker/bookTicker"); }
  return mapa(d, x => [x.symbol, x.bidPrice, x.askPrice]);
}

// Melhor preço de compra e venda de todas as moedas, por corretora
export const TICKERS = {
  binance: binanceTickers,
  bybit: async () => mapa((await j("https://api.bybit.com/v5/market/tickers?category=spot")).result?.list,
    x => [x.symbol, x.bid1Price, x.ask1Price]),
  okx: async () => mapa((await j("https://www.okx.com/api/v5/market/tickers?instType=SPOT")).data,
    x => [x.instId, x.bidPx, x.askPx]),
  bitget: async () => mapa((await j("https://api.bitget.com/api/v2/spot/market/tickers")).data,
    x => [x.symbol, x.bidPr, x.askPr]),
  kucoin: async () => mapa((await j("https://api.kucoin.com/api/v1/market/allTickers")).data?.ticker,
    x => [x.symbol, x.buy, x.sell]),
  gate: async () => mapa(await j("https://api.gateio.ws/api/v4/spot/tickers"),
    x => [x.currency_pair, x.highest_bid, x.lowest_ask]),
  mexc: async () => mapa(await j("https://api.mexc.com/api/v3/ticker/bookTicker"),
    x => [x.symbol, x.bidPrice, x.askPrice]),
  bingx: async (moedas) => {
    const out = mapa((await j(`https://open-api.bingx.com/openApi/spot/v1/ticker/24hr?timestamp=${Date.now()}`)).data,
      x => [x.symbol, x.bidPrice, x.askPrice]);
    // se a lista geral não trouxer o melhor preço, pergunta moeda por moeda
    const faltam = moedas.filter(m => !out[PAR.bingx(m)]);
    await Promise.all(faltam.map(async m => {
      try {
        const d = await j(`https://open-api.bingx.com/openApi/spot/v1/ticker/bookTicker?symbol=${PAR.bingx(m)}&timestamp=${Date.now()}`);
        const x = Array.isArray(d.data) ? d.data[0] : d.data;
        if (x && num(x.bidPrice) && num(x.askPrice)) out[PAR.bingx(m)] = { bid: num(x.bidPrice), ask: num(x.askPrice) };
      } catch {}
    }));
    return out;
  },
  coinex: async (moedas) => {
    const out = {};
    let erro = null;
    await Promise.all(moedas.map(async m => {
      try {
        const d = await j(`https://api.coinex.com/v2/spot/depth?market=${PAR.coinex(m)}&limit=5&interval=0`);
        if (d.code !== 0) throw new Error(d.message || `código ${d.code}`);
        const bid = num(d.data?.depth?.bids?.[0]?.[0]), ask = num(d.data?.depth?.asks?.[0]?.[0]);
        if (bid && ask) out[PAR.coinex(m)] = { bid, ask };
      } catch (e) { erro = erro || e; }
    }));
    // se nenhuma moeda veio, mostra o motivo no painel
    if (!Object.keys(out).length && erro) throw erro;
    return out;
  },
};

// Livro de ofertas (até 50 níveis de cada lado)
export const LIVRO = {
  binance: async m => {
    let d;
    try { d = await j(`https://data-api.binance.vision/api/v3/depth?symbol=${PAR.binance(m)}&limit=50`); }
    catch { d = await j(`https://api.binance.com/api/v3/depth?symbol=${PAR.binance(m)}&limit=50`); }
    return [d.asks, d.bids];
  },
  bybit: async m => { const d = await j(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${PAR.bybit(m)}&limit=50`); return [d.result?.a, d.result?.b]; },
  okx: async m => { const d = await j(`https://www.okx.com/api/v5/market/books?instId=${PAR.okx(m)}&sz=50`); return [d.data?.[0]?.asks, d.data?.[0]?.bids]; },
  bitget: async m => { const d = await j(`https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${PAR.bitget(m)}&type=step0&limit=50`); return [d.data?.asks, d.data?.bids]; },
  kucoin: async m => { const d = await j(`https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=${PAR.kucoin(m)}`); return [d.data?.asks, d.data?.bids]; },
  gate: async m => { const d = await j(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${PAR.gate(m)}&limit=50`); return [d.asks, d.bids]; },
  mexc: async m => { const d = await j(`https://api.mexc.com/api/v3/depth?symbol=${PAR.mexc(m)}&limit=50`); return [d.asks, d.bids]; },
  bingx: async m => { const d = await j(`https://open-api.bingx.com/openApi/spot/v1/market/depth?symbol=${PAR.bingx(m)}&limit=50&timestamp=${Date.now()}`); return [d.data?.asks, d.data?.bids]; },
  coinex: async m => { const d = await j(`https://api.coinex.com/v2/spot/depth?market=${PAR.coinex(m)}&limit=50&interval=0`); return [d.data?.depth?.asks, d.data?.depth?.bids]; },
};

// Cotação do dólar digital (USDT) em reais
export async function cotacao(binance) {
  const t = binance && binance.USDTBRL;
  if (t) return { valor: (t.bid + t.ask) / 2, fonte: "USDT/BRL na Binance", ao_vivo: true };
  try {
    const d = await j("https://economia.awesomeapi.com.br/json/last/USD-BRL");
    return { valor: parseFloat(d.USDBRL.bid), fonte: "dólar comercial (AwesomeAPI)", ao_vivo: true };
  } catch {
    return { valor: 5.5, fonte: "estimada (sem conexão)", ao_vivo: false };
  }
}

export const MOEDA_OK = /^[A-Z0-9]{1,15}$/;

export function erroCurto(e) {
  const msg = String(e?.name === "TimeoutError" ? "a corretora demorou demais para responder" : (e?.message || e));
  return msg.split("\n")[0].slice(0, 160);
}
