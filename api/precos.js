// GET /api/precos?moedas=BTC,ETH&corretoras=binance,bybit
// Devolve o melhor preço de compra (ask) e de venda (bid) de cada moeda em cada corretora,
// mais a cotação do dólar em reais.
import { NOMES, TICKERS, PAR, cotacao, MOEDA_OK, erroCurto } from "./_corretoras.js";

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const moedas = (url.searchParams.get("moedas") || "BTC,ETH")
    .split(",").map(s => s.trim().toUpperCase()).filter(m => MOEDA_OK.test(m)).slice(0, 30);
  const pedidas = (url.searchParams.get("corretoras") || Object.keys(NOMES).join(","))
    .split(",").filter(c => c in NOMES);
  // a Binance é lida sempre, porque dela vem a cotação do dólar
  const lidas = [...new Set([...pedidas, "binance"])];

  const precos = {}, erros = {};
  let binanceBruto = null;
  await Promise.all(lidas.map(async c => {
    try {
      const todos = await TICKERS[c](moedas);
      if (c === "binance") binanceBruto = todos;
      if (!pedidas.includes(c)) return;
      precos[c] = {};
      for (const m of moedas) {
        const t = todos[PAR[c](m)];
        if (t && t.ask >= t.bid * 0.5) precos[c][m] = t;
      }
    } catch (e) {
      if (pedidas.includes(c)) erros[c] = erroCurto(e);
    }
  }));

  const cot = await cotacao(binanceBruto);
  res.setHeader("Cache-Control", "public, s-maxage=3, stale-while-revalidate=2");
  res.status(200).json({ precos, erros, cotacao: cot, t: Date.now() / 1000, regiao: process.env.VERCEL_REGION || "local" });
}
