// Robô da Mesa de Arbitragem (simulação 24h)
// Roda pelo GitHub Actions. Lê o estado em ESTADO (arquivo JSON), procura oportunidades de
// USDT/BRL usando os preços do servidor de São Paulo (Vercel) e grava o resultado.
// Dinheiro virtual: nada aqui toca em corretora de verdade.
//
// Regras:
//  - só compra se o lucro previsto, já com todas as taxas, for >= minimo (%)
//  - nunca vende no prejuízo: se o preço piorar durante a transferência, segura o USDT e espera

import fs from "node:fs";

const ESTADO = process.argv[2] || "estado.json";
const API = process.env.API_URL || "https://radar-arbitragem.vercel.app";
const DURACAO_MS = +(process.env.DURACAO_MS || 270000);   // ~4,5 min por rodada
const PASSO_MS = +(process.env.PASSO_MS || 15000);         // checa a cada 15 s

const NOMES = {
  binance:"Binance", bitget:"Bitget", bybit:"Bybit", kucoin:"KuCoin", mercadobitcoin:"Mercado Bitcoin", bitso:"Bitso",
  novadax:"NovaDAX", foxbit:"Foxbit", mexc:"MEXC", avenia:"Avenia", chainless:"Chainless", picnic:"Picnic", polygon:"Carteira Polygon",
};
const nome = c => NOMES[c] || c;
const nf = (n, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const R = n => "R$ " + nf(n);
const RS = n => (n >= 0 ? "+" : "−") + "R$ " + nf(Math.abs(n));
const pct = n => (n >= 0 ? "+" : "") + nf(n, 3) + "%";
const dorme = ms => new Promise(r => setTimeout(r, ms));

const e = JSON.parse(fs.readFileSync(ESTADO, "utf8"));
const cfg = e.config;
e.log = e.log || []; e.hist = e.hist || []; e.pendente = e.pendente || null;

function log(txt, tipo = "") { e.log.unshift({ t: Date.now(), txt, tipo }); e.log = e.log.slice(0, 300); console.log(new Date().toISOString(), txt); }
function salvar() { e.atualizado = Date.now(); fs.writeFileSync(ESTADO, JSON.stringify(e)); }

function percorrer(niveis, qtd, porValor) {
  let resto = qtd, rec = 0, gasto = 0;
  for (const [p, v] of niveis || []) {
    const usar = porValor ? Math.min(resto, p * v) : Math.min(resto, v);
    rec += porValor ? usar / p : usar * p; gasto += usar; resto -= usar;
    if (resto <= 1e-9) break;
  }
  return { rec, medio: porValor ? (rec ? gasto / rec : 0) : (gasto ? rec / gasto : 0), faltou: resto > 1e-6 };
}
function calcRota(a, b, valor, A, B) {
  const fa = (cfg.taxas[a] ?? 0.1) / 100, fb = (cfg.taxas[b] ?? 0.1) / 100;
  const c = percorrer(A.asks, valor, true);
  const taxaA = c.rec * fa, saque = cfg.saque[a] ?? 1;
  const chega = Math.max(c.rec - taxaA - saque, 0);
  const v = percorrer(B.bids, chega, false);
  const final = v.rec * (1 - fb), lucro = final - valor;
  return { a, b, valor, usdt: c.rec - taxaA, medioCompra: c.medio, taxaA, saque, chega, medioVenda: v.medio, final, lucro,
    pct: lucro / valor * 100, faltou: c.faltou || v.faltou };
}
async function precos() {
  const r = await fetch(`${API}/api/brl?corretoras=${cfg.corretoras.join(",")}&niveis=50&_=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error("servidor de preços respondeu " + r.status);
  return (await r.json()).cotacoes;
}
// Pix simulado: junta reais de outras corretoras na corretora 'para'
function puxarReais(para, quanto) {
  let falta = quanto, movido = 0;
  for (const c of Object.keys(e.saldos).filter(c => c !== para && e.saldos[c].brl > 0).sort((x, y) => e.saldos[y].brl - e.saldos[x].brl)) {
    if (falta <= 0.004) break;
    const m = Math.min(falta, e.saldos[c].brl); e.saldos[c].brl -= m; e.saldos[para].brl += m; falta -= m; movido += m;
  }
  return movido;
}

async function passo() {
  const q = await precos();
  const agora = Date.now();

  // 1) existe USDT a caminho ou segurado: tenta vender sem prejuízo
  if (e.pendente) {
    const p = e.pendente;
    if (agora < p.chegaEm) return;
    if (!q[p.b]) { log(`Sem preço da ${nome(p.b)} agora; tentando de novo na próxima checagem`, "warn"); return; }
    const v = percorrer(q[p.b].bids, p.chega, false);
    const final = v.rec * (1 - (cfg.taxas[p.b] ?? 0.1) / 100);
    const lucro = final - p.valor;
    if (v.faltou || lucro < 0) {
      if (!p.segurandoDesde) { p.segurandoDesde = agora; log(`Preço na ${nome(p.b)} piorou: vender agora daria ${RS(lucro)}. Segurando o USDT até dar para vender sem prejuízo.`, "warn"); }
      else if (agora - (p.ultimoAviso || 0) > 30 * 60000) { p.ultimoAviso = agora; log(`Ainda segurando ${nf(p.chega)} USDT na ${nome(p.b)} (vender agora daria ${RS(lucro)})`, "warn"); }
      return;
    }
    e.saldos[p.b].usdt -= p.chega; e.saldos[p.b].brl += final;
    e.hist.unshift({ id: p.id, t: agora, a: p.a, b: p.b, valor: p.valor, usdt: p.chega, compra: p.medioCompra, venda: v.medio,
      taxas: p.taxaA * p.medioCompra + p.saque * p.medioCompra + v.rec * (cfg.taxas[p.b] ?? 0.1) / 100,
      lucro, pct: lucro / p.valor * 100, previsto: p.previsto, auto: true, final, modo: "transferir", servidor: true });
    log(`Robô concluiu: ${nome(p.a)} → ${nome(p.b)} · ${RS(lucro)} (${pct(lucro / p.valor * 100)})`, "good");
    e.pendente = null; e.ultimaOp = agora;
    salvar();
    return;
  }

  // 2) intervalo mínimo entre operações
  if (e.ultimaOp && agora - e.ultimaOp < (cfg.intervaloMin ?? 1) * 60000) return;

  // 3) procurar a melhor rota com o dinheiro disponível
  const total = Object.values(e.saldos).reduce((t, s) => t + s.brl, 0);
  if (total < 50) { if (agora - (e.avisoSemSaldo || 0) > 3600000) { e.avisoSemSaldo = agora; log("Sem reais para operar.", "warn"); } return; }
  const valor = Math.floor(Math.min(cfg.max, total) * 100) / 100;
  let melhor = null;
  const ativas = cfg.corretoras.filter(c => q[c]);
  for (const a of ativas) for (const b of ativas) {
    if (a === b) continue;
    const r = calcRota(a, b, valor, q[a], q[b]);
    if (!r.faltou && (!melhor || r.pct > melhor.pct)) melhor = r;
  }
  if (!melhor) return;
  if (melhor.pct < cfg.minimo || melhor.lucro <= 0) {
    if (agora - (e.ultimoProcurando || 0) > 10 * 60000) { e.ultimoProcurando = agora; log(`Procurando… melhor rota agora ${nome(melhor.a)} → ${nome(melhor.b)} ${pct(melhor.pct)} (mínimo ${nf(cfg.minimo, 2)}%)`, "faint"); }
    return;
  }

  // 4) comprar: leva os reais (Pix simulado), compra e manda o USDT para a corretora de venda
  if (e.saldos[melhor.a].brl < valor) {
    const mv = puxarReais(melhor.a, valor - e.saldos[melhor.a].brl);
    if (mv > 0) log(`Pix simulado: ${R(mv)} levados para a ${nome(melhor.a)}`, "acc");
  }
  e.saldos[melhor.a].brl -= valor;
  e.saldos[melhor.b].usdt += melhor.chega;
  e.pendente = { id: agora, a: melhor.a, b: melhor.b, valor, chega: melhor.chega, medioCompra: melhor.medioCompra, taxaA: melhor.taxaA,
    saque: melhor.saque, previsto: melhor.lucro, chegaEm: agora + (cfg.transferenciaSeg ?? 120) * 1000 };
  log(`Comprou ${nf(melhor.usdt)} USDT na ${nome(melhor.a)} a ${nf(melhor.medioCompra, 4)} com ${R(valor)} e enviou para a ${nome(melhor.b)} · previsto ${RS(melhor.lucro)} (${pct(melhor.pct)})`, "acc");
  salvar();
}

const fim = Date.now() + DURACAO_MS;
e.rodadas = (e.rodadas || 0) + 1;
while (Date.now() < fim) {
  try { await passo(); } catch (err) { console.log("erro:", err.message); }
  e.verificado = Date.now();
  await dorme(PASSO_MS);
}
salvar();
