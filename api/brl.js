// GET /api/brl?corretoras=binance,bitget,...
// Devolve, para cada corretora, o livro de ofertas de USDT/BRL (10 níveis de cada lado)
// e o melhor preço de compra (ask) e de venda (bid).
import { BRL, livroBrl } from "./_brl.js";
import { erroCurto } from "./_corretoras.js";

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const pedidas = (url.searchParams.get("corretoras") || Object.keys(BRL).join(","))
    .split(",").filter(c => c in BRL);
  const profundidade = Math.min(Math.max(parseInt(url.searchParams.get("niveis") || "10", 10) || 10, 1), 50);

  const cotacoes = {}, erros = {};
  await Promise.all(pedidas.map(async c => {
    const inicio = Date.now();
    try {
      const { asks, bids } = await livroBrl(c);
      cotacoes[c] = {
        ask: asks[0][0], bid: bids[0][0],
        asks: asks.slice(0, profundidade), bids: bids.slice(0, profundidade),
        ms: Date.now() - inicio,
      };
    } catch (e) {
      erros[c] = erroCurto(e);
    }
  }));

  if (Object.keys(erros).length) console.log("erros:", JSON.stringify(erros));
  res.setHeader("Cache-Control", "public, s-maxage=2, stale-while-revalidate=2");
  res.status(200).json({ cotacoes, erros, t: Date.now() / 1000, regiao: process.env.VERCEL_REGION || "local" });
}
