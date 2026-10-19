// GET /api/livro?corretora=binance&moeda=BTC
// Devolve o livro de ofertas: asks (quem vende, do mais barato ao mais caro)
// e bids (quem compra, do que paga mais ao que paga menos).
import { NOMES, LIVRO, MOEDA_OK, erroCurto } from "./_corretoras.js";

const limpar = lado => (lado || [])
  .map(n => [parseFloat(n[0]), parseFloat(n[1])])
  .filter(([p, q]) => p > 0 && q > 0);

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const c = url.searchParams.get("corretora");
  const m = (url.searchParams.get("moeda") || "").toUpperCase();
  if (!(c in NOMES) || !MOEDA_OK.test(m)) {
    return res.status(400).json({ erro: "corretora ou moeda inválida" });
  }
  try {
    const [asks, bids] = await LIVRO[c](m);
    const a = limpar(asks).sort((x, y) => x[0] - y[0]);
    const b = limpar(bids).sort((x, y) => y[0] - x[0]);
    if (!a.length || !b.length) throw new Error(`${NOMES[c]} não tem ofertas de ${m}/USDT`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ asks: a, bids: b, t: Date.now() / 1000 });
  } catch (e) {
    res.status(502).json({ erro: erroCurto(e) });
  }
}
