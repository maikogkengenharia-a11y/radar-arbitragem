// Radar de TODAS as corretoras (só observação, dados públicos, sem chave nenhuma).
// Serve para descobrir quais rotas dão lucro de verdade antes de abrir conta/criar chave em cada corretora.
import { livroBrl } from "../api/_brl.js";

export const NOME = {
  binance: "Binance", bitget: "Bitget", bybit: "Bybit", okx: "OKX", mercadobitcoin: "Mercado Bitcoin",
  bitso: "Bitso", foxbit: "Foxbit", polygon: "KyberSwap BRLA (Picnic/Avenia)", chainless: "KyberSwap BRZ (Chainless)",
};
const LISTA = Object.keys(NOME);
// mesmas taxas do simulador: negociação (%) e saque do USDT (em USDT, rede mais barata)
const TAXA = { binance: 0.10, bitget: 0.10, bybit: 0.10, okx: 0.10, mercadobitcoin: 0.70, bitso: 0.65, foxbit: 0.50, polygon: 0.02, chainless: 0.05 };
const SAQUE = { binance: 0.03, bitget: 0.10, bybit: 0.30, okx: 0.50, mercadobitcoin: 1, bitso: 1, foxbit: 1, polygon: 0.02, chainless: 0.02 };

function compra(asks, brl) {
  let usdt = 0, resto = brl;
  for (const [p, q] of asks) {
    if (p * q >= resto) return usdt + resto / p;
    usdt += q; resto -= p * q;
  }
  return null;
}
function venda(bids, usdt) {
  let brl = 0, resto = usdt;
  for (const [p, q] of bids) {
    const x = Math.min(q, resto);
    brl += x * p; resto -= x;
    if (resto <= 1e-12) return brl;
  }
  return null;
}

export async function radar(valor) {
  const livros = {}, erros = {};
  await Promise.all(LISTA.map(async c => {
    try { livros[c] = await livroBrl(c); } catch (e) { erros[c] = String(e?.message || e).slice(0, 80); }
  }));
  const rotas = [];
  for (const a of LISTA) for (const b of LISTA) {
    if (a === b || !livros[a] || !livros[b]) continue;
    let u = compra(livros[a].asks, valor);
    if (!u) continue;
    u = u * (1 - TAXA[a] / 100) - SAQUE[a];
    if (u <= 0) continue;
    const bruto = venda(livros[b].bids, u);
    if (!bruto) continue;
    const brl = bruto * (1 - TAXA[b] / 100);
    const lucro = brl - valor;
    rotas.push({ a, b, lucro: Math.round(lucro * 100) / 100, pct: +((lucro / valor) * 100).toFixed(3), real: [a, b].sort().join() === "binance,polygon" });
  }
  rotas.sort((x, y) => y.pct - x.pct);
  const precos = Object.fromEntries(Object.entries(livros).map(([c, l]) => [c, { ask: l.asks[0][0], bid: l.bids[0][0] }]));
  return { t: Date.now(), valor, rotas, precos, erros };
}
