// Motor da Mesa de Arbitragem (simulação).
// Roda no servidor do robô (Hostinger), 24h. O estado (saldos, histórico, atividade, operação em andamento,
// liga/desliga) fica num arquivo do próprio servidor. Antes ficava no Vercel Blob, que tem limite de gravações.
// Regras: só compra com lucro previsto >= mínimo (já com todas as taxas) e nunca vende no prejuízo.
import fs from "node:fs";
import path from "node:path";
import { BRL, livroBrl } from "./_brl.js";

const ARQ = process.env.SIM_ARQ || "/var/lib/robo/simulador.json";
const SEMENTE = "https://raw.githubusercontent.com/maikogkengenharia-a11y/radar-arbitragem/dados/estado.json";

const nome = c => BRL[c] || c;
const nf = (n, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const R = n => "R$ " + nf(n);
const RS = n => (n >= 0 ? "+" : "−") + "R$ " + nf(Math.abs(n));
const pct = n => (n >= 0 ? "+" : "") + nf(n, 3) + "%";

// ---------------------------------------------------------------- estado
export async function lerEstado() {
  let txt = null;
  try { txt = fs.readFileSync(ARQ, "utf8"); } catch {}
  if (txt) {
    const e = JSON.parse(txt);
    migrar(e); normalizar(e);
    return { e, etag: null };
  }
  // primeira vez: começa do estado inicial guardado no GitHub
  const s = await fetch(SEMENTE, { signal: AbortSignal.timeout(10000) });
  const e = await s.json();
  migrar(e); normalizar(e);
  e.ligado = e.ligado !== false;
  return { e, etag: null };
}
// ajustes de taxas reais conferidas pelo usuário
function migrar(e) {
  if ((e.taxasVersao || 0) < 1) {
    e.config.saque.binance = 0.03; // saque de USDT pela rede Polygon POS (conferido na Binance em 19/10)
    e.taxasVersao = 1;
    e.log = e.log || [];
    e.log.unshift({ t: Date.now(), txt: "Taxa real de saque da Binance pela Polygon aplicada: 0,03 USDT", tipo: "acc" });
  }
  if ((e.taxasVersao || 0) < 2) {
    e.config.taxas.picnic = 0.01; // resgate BRLA → Pix na Picnic é grátis (conferido em 19/10); sobra só a taxa de rede
    e.taxasVersao = 2;
    e.log.unshift({ t: Date.now(), txt: "Taxa real da Picnic aplicada: resgate de BRLA para Pix grátis", tipo: "acc" });
  }
  if ((e.taxasVersao || 0) < 3) {
    // nova rodada da simulação pedida pelo usuário em 20/10: R$ 5.000 na Binance, lucro mínimo 0,02%
    const h = e.hist || [], soma = h.reduce((t, x) => t + (x.lucro || 0), 0);
    e.rodadasAnteriores = e.rodadasAnteriores || [];
    e.rodadasAnteriores.push({ fim: Date.now(), aportes: e.aportes, operacoes: h.length, lucro: soma, pendente: e.pendente || null, hist: h });
    for (const c of Object.keys(e.saldos)) e.saldos[c] = { brl: 0, usdt: 0 };
    e.saldos.binance = { brl: 5000, usdt: 0 };
    e.aportes = 5000;
    e.hist = [];
    e.pendente = null;
    e.ultimaOp = 0;
    e.config.minimo = 0.02;
    e.config.max = 5000;
    e.criado = Date.now();
    e.taxasVersao = 3;
    e.log.unshift({ t: Date.now(), txt: `Nova simulação: R$ 5.000 na Binance, lucro mínimo 0,02% já com todas as taxas, até R$ 5.000 por operação. Rodada anterior (R$ 1.000): ${h.length} operações, ${RS(soma)}; a operação que estava segurando USDT foi encerrada.`, tipo: "good" });
  }
  if ((e.taxasVersao || 0) < 4) {
    // 20/10: dividir o capital para pegar até 2 oportunidades ao mesmo tempo
    e.config.max = 2500;
    e.taxasVersao = 4;
    log(e, "Regra nova: até R$ 2.500 por operação (com R$ 5.000 dá para 2 ao mesmo tempo). Se o USDT ficar preso, o robô procura outra corretora onde a venda dê lucro.", "acc");
  }
  if ((e.taxasVersao || 0) < 5) {
    // 20/10 09:43: recomeçar do zero para testar no manual: R$ 5.000 na Binance, uma operação por vez, robô automático desligado
    const h = e.hist || [], soma = h.reduce((t, x) => t + (x.lucro || 0), 0);
    e.rodadasAnteriores = e.rodadasAnteriores || [];
    e.rodadasAnteriores.push({ fim: Date.now(), aportes: e.aportes, operacoes: h.length, lucro: soma, pendente: e.pendentes || e.pendente || null, hist: h });
    for (const c of Object.keys(e.saldos)) e.saldos[c] = { brl: 0, usdt: 0 };
    e.saldos.binance = { brl: 5000, usdt: 0 };
    e.aportes = 5000; e.hist = []; e.pendentes = []; e.pendente = null; e.ultimaOp = 0;
    e.config.max = 5000; e.config.minimo = 0.02;
    e.ligado = false;
    e.criado = Date.now();
    e.taxasVersao = 5;
    e.log = [{ t: Date.now(), txt: "Simulação reiniciada: R$ 5.000 na Binance, uma operação por vez, robô automático DESLIGADO (modo manual: clique em Executar nas oportunidades). Lucro mínimo 0,02%.", tipo: "good" }];
  }
  if ((e.taxasVersao || 0) < 6) {
    // 20/10: simulador igual ao real — sem Pix grátis entre corretoras; a volta para a Binance tem custo de verdade
    e.credito = Math.max(0, (e.hist || []).reduce((t, x) => t + (x.lucro || 0), 0));
    e.taxasVersao = 6;
    log(e, "Simulador igual ao real: o dinheiro só sai da corretora onde está (sem Pix grátis). A volta para a Binance usa o lucro da ida para pagar o custo, e o ciclo nunca fica negativo.", "acc");
  }
  if ((e.taxasVersao || 0) < 7) {
    // 20/10 11:00: recomeçar do zero com as regras iguais às do real
    const h = e.hist || [], soma = h.reduce((t, x) => t + (x.lucro || 0), 0);
    e.rodadasAnteriores = e.rodadasAnteriores || [];
    e.rodadasAnteriores.push({ fim: Date.now(), aportes: e.aportes, operacoes: h.length, lucro: soma, pendente: e.pendentes || null, hist: h, saldos: e.saldos });
    for (const c of Object.keys(e.saldos)) e.saldos[c] = { brl: 0, usdt: 0 };
    e.saldos.binance = { brl: 5000, usdt: 0 };
    e.aportes = 5000; e.hist = []; e.pendentes = []; e.pendente = null; e.ultimaOp = 0; e.credito = 0;
    e.config.max = 5000; e.config.minimo = 0.02; e.ligado = false; e.criado = Date.now();
    e.taxasVersao = 7;
    e.log = [{ t: Date.now(), txt: "Simulação zerada: R$ 5.000 na Binance, regras iguais às do real (sem Pix grátis; volta para a Binance com custo real), uma operação por vez, automático desligado.", tipo: "good" }];
  }
  if ((e.taxasVersao || 0) < 8) {
    // 21/10: OKX entra (tem USDT/BRL); Chainless passa a usar BRZ na KyberSwap
    if (!e.config.corretoras.includes("okx")) e.config.corretoras.push("okx");
    e.config.taxas.okx = e.config.taxas.okx ?? 0.10;
    e.config.saque.okx = e.config.saque.okx ?? 0.50;
    e.config.intervaloMin = e.config.intervaloMin ?? 1;
    e.taxasVersao = 8;
    log(e, "OKX conectada ao simulador (USDT/BRL). A Chainless agora usa BRZ na KyberSwap, que costuma pagar mais que o BRLA.", "acc");
  }
}
const MAX_SIMULTANEAS = 1; // uma operação por vez (pedido do usuário em 20/10)
// várias operações ao mesmo tempo; "pendente" continua existindo (a mais antiga) para o painel
function normalizar(e) {
  if (!Array.isArray(e.pendentes)) e.pendentes = e.pendente ? [e.pendente] : [];
  e.pendente = e.pendentes[0] || null;
}
export async function salvarEstado(e) {
  normalizar(e);
  e.atualizado = Date.now();
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(ARQ + ".tmp", JSON.stringify(e));
  fs.renameSync(ARQ + ".tmp", ARQ);
}
// lê, altera e grava; se outra parte gravou no meio, tenta de novo
// uma alteração de cada vez (fila), para duas partes nunca gravarem por cima uma da outra
let fila = Promise.resolve();
export function alterar(fn) {
  const vez = fila.then(async () => {
    const { e } = await lerEstado();
    const out = await fn(e);
    if (!(out && out.semGravar)) await salvarEstado(e);
    return out;
  });
  fila = vez.catch(() => {});
  return vez;
}

function log(e, txt, tipo = "") { e.log = e.log || []; e.log.unshift({ t: Date.now(), txt, tipo }); e.log = e.log.slice(0, 300); }

// ---------------------------------------------------------------- cálculo
function percorrer(niveis, qtd, porValor) {
  let resto = qtd, rec = 0, gasto = 0;
  for (const [p, v] of niveis || []) {
    const usar = porValor ? Math.min(resto, p * v) : Math.min(resto, v);
    rec += porValor ? usar / p : usar * p; gasto += usar; resto -= usar;
    if (resto <= 1e-9) break;
  }
  return { rec, medio: porValor ? (rec ? gasto / rec : 0) : (gasto ? rec / gasto : 0), faltou: resto > 1e-6 };
}
function calcRota(cfg, a, b, valor, A, B) {
  const fa = (cfg.taxas[a] ?? 0.1) / 100, fb = (cfg.taxas[b] ?? 0.1) / 100;
  const c = percorrer(A.asks, valor, true);
  const taxaA = c.rec * fa, saque = cfg.saque[a] ?? 1;
  const chega = Math.max(c.rec - taxaA - saque, 0);
  const v = percorrer(B.bids, chega, false);
  const final = v.rec * (1 - fb), lucro = final - valor;
  return { a, b, valor, usdt: c.rec - taxaA, medioCompra: c.medio, taxaA, saque, chega, medioVenda: v.medio, final, lucro,
    pct: lucro / valor * 100, faltou: c.faltou || v.faltou };
}
export async function precos(lista) {
  const out = {};
  await Promise.all(lista.filter(c => c in BRL).map(async c => { try { out[c] = await livroBrl(c); } catch {} }));
  return out;
}
const totalBrl = e => Object.values(e.saldos).reduce((t, s) => t + s.brl, 0);
function puxarReais(e, para, quanto) {
  let falta = quanto, movido = 0;
  for (const c of Object.keys(e.saldos).filter(c => c !== para && e.saldos[c].brl > 0).sort((x, y) => e.saldos[y].brl - e.saldos[x].brl)) {
    if (falta <= 0.004) break;
    const m = Math.min(falta, e.saldos[c].brl); e.saldos[c].brl -= m; e.saldos[para].brl += m; falta -= m; movido += m;
  }
  return movido;
}

// ---------------------------------------------------------------- operações
function comprar(e, r, manual) { const p = abrir(e, r, manual); logCompra(e, r, manual); return p; }
function abrir(e, r, manual) {
  const agora = Date.now();
  e.saldos[r.a].brl -= r.valor; // igual ao real: só usa o dinheiro que já está nesta corretora
  e.saldos[r.b].usdt += r.chega;
  const p = { id: agora + Math.floor(Math.random() * 1000), a: r.a, b: r.b, valor: r.valor, usdt: r.usdt, chega: r.chega, medioCompra: r.medioCompra, taxaA: r.taxaA, saque: r.saque,
    previsto: r.lucro, previstoPct: r.pct, manual: !!manual, inicio: agora, chegaEm: agora + (e.config.transferenciaSeg ?? 120) * 1000, credito: r.credito || 0, retorno: !!r.retorno };
  e.pendentes.push(p); e.pendente = e.pendentes[0];
  return p;
}
function logCompra(e, r, manual) {
  log(e, `${manual ? "Operação manual" : "Robô"}: comprou ${nf(r.usdt)} USDT na ${nome(r.a)} a ${nf(r.medioCompra, 4)} com ${R(r.valor)} e enviou para a ${nome(r.b)} · previsto ${RS(r.lucro)} (${pct(r.pct)})`, "acc");
}
// tenta concluir a venda; nunca vende no prejuízo.
// Se vender onde o USDT está daria prejuízo, procura outra corretora onde dê lucro
// (descontando mais um saque) e manda o USDT para lá.
function venderEm(e, q, c, usdt) {
  if (!q[c]) return null;
  const v = percorrer(q[c].bids, usdt, false);
  if (v.faltou) return null;
  const fb = (e.config.taxas[c] ?? 0.1) / 100;
  return { v, fb, final: v.rec * (1 - fb) };
}
function tentarVender(e, q, p) {
  const agora = Date.now();
  if (agora < p.chegaEm) return false;
  const aqui = venderEm(e, q, p.b, p.chega);
  const lucro = aqui ? aqui.final - p.valor : -Infinity;
  if (!aqui || lucro < -(p.credito || 0)) {
    // procura outro destino para o USDT preso
    const taxaSaque = e.config.saque[p.b] ?? 1, chega2 = p.chega - taxaSaque;
    let alt = null;
    if (chega2 > 0) for (const c of e.config.corretoras) {
      if (c === p.b) continue;
      const x = venderEm(e, q, c, chega2);
      if (!x) continue;
      const l = x.final - p.valor;
      if (l >= Math.max(0, p.valor * (e.config.minimo || 0) / 100 * 0.5) && (!alt || l > alt.l)) alt = { c, l };
    }
    if (alt) {
      e.saldos[p.b].usdt -= p.chega; e.saldos[alt.c].usdt += chega2;
      log(e, `Redirecionando: vender na ${nome(p.b)} daria ${aqui ? RS(lucro) : "prejuízo"}. Mandei os ${nf(chega2)} USDT para a ${nome(alt.c)}, onde a venda dá ${RS(alt.l)}.`, "acc");
      p.saque += taxaSaque; p.via = [...(p.via || []), p.b]; p.b = alt.c; p.chega = chega2;
      p.chegaEm = agora + (e.config.transferenciaSeg ?? 120) * 1000;
      delete p.segurandoDesde; delete p.ultimoAviso;
      return true;
    }
    if (!p.segurandoDesde) { p.segurandoDesde = agora; log(e, `Preço na ${nome(p.b)} piorou: vender agora daria ${aqui ? RS(lucro) : "—"}. Segurando o USDT até dar para vender sem prejuízo (ou achar outra corretora onde dê).`, "warn"); }
    else if (agora - (p.ultimoAviso || 0) > 30 * 60000) { p.ultimoAviso = agora; log(e, `Ainda segurando ${nf(p.chega)} USDT na ${nome(p.b)} (vender agora daria ${aqui ? RS(lucro) : "—"})`, "warn"); }
    return true;
  }
  const { v, fb, final } = aqui;
  e.saldos[p.b].usdt -= p.chega; e.saldos[p.b].brl += final;
  e.hist = e.hist || [];
  e.hist.unshift({ id: p.id, t: agora, a: p.a, b: p.b, valor: p.valor, usdt: p.chega, compra: p.medioCompra, venda: v.medio,
    taxas: (p.taxaA + p.saque) * p.medioCompra + v.rec * fb, lucro, pct: lucro / p.valor * 100, previsto: p.previsto,
    auto: !p.manual, final, modo: "transferir", servidor: true, duracao: agora - p.inicio, via: p.via || null });
  e.hist = e.hist.slice(0, 2000);
  log(e, `${p.manual ? "Operação manual concluída" : "Robô concluiu"}: ${nome(p.a)} → ${p.via ? p.via.map(nome).join(" → ") + " → " : ""}${nome(p.b)} · ${RS(lucro)} (${pct(lucro / p.valor * 100)})`, "good");
  e.ultimaOp = agora;
  e.pendentes = e.pendentes.filter(x => x !== p);
  creditar(e, p, lucro);
  return true;
}
// "crédito" = lucro das idas que ainda pode pagar a volta para a casa (Binance)
const CASA = "binance";
function creditar(e, p, lucro) {
  if (p.a === CASA) e.credito = (e.credito || 0) + Math.max(0, lucro);
  else e.credito = Math.max(0, (e.credito || 0) + lucro);
}
// rotas possíveis agora: só saem de onde há reais; a volta para a Binance vale quando ida + volta não ficam negativas
function rotasPossiveis(e, q) {
  const out = [], credito = e.credito || 0;
  const ativas = [...new Set([...e.config.corretoras, ...Object.keys(e.saldos).filter(c => e.saldos[c].brl >= 50)])].filter(c => q[c]);
  for (const a of ativas) {
    const saldo = e.saldos[a].brl;
    if (saldo < 50) continue;
    const valor = Math.floor((a === CASA ? Math.min(e.config.max, saldo) : saldo) * 100) / 100;
    for (const b of ativas) {
      if (a === b) continue;
      const r = calcRota(e.config, a, b, valor, q[a], q[b]);
      if (r.faltou) continue;
      if (r.lucro > 0 && r.pct >= e.config.minimo) out.push(r);
      else if (a !== CASA && b === CASA && r.lucro + credito >= 0) out.push({ ...r, retorno: true, credito });
    }
  }
  return out.sort((x, y) => (y.retorno ? 1 : 0) - (x.retorno ? 1 : 0) || y.pct - x.pct);
}
function melhorRota(e, q) {
  let melhor = null;
  const ativas = e.config.corretoras.filter(c => q[c]);
  const valor = e.config.max;
  for (const a of ativas) for (const b of ativas) {
    if (a === b) continue;
    const r = calcRota(e.config, a, b, valor, q[a], q[b]);
    if (!r.faltou && (!melhor || r.pct > melhor.pct)) melhor = r;
  }
  return melhor;
}

// uma checagem do robô
export async function tick() {
  const { e: e0 } = await lerEstado();
  normalizar(e0);
  const lista = [...new Set([...e0.config.corretoras, ...e0.pendentes.map(p => p.b), ...Object.keys(e0.saldos).filter(c => e0.saldos[c].brl >= 50)])];
  const q = await precos(lista);
  return alterar(e => {
    const agora = Date.now();
    e.verificado = agora;
    let mudou = false;
    for (const p of [...e.pendentes]) mudou = tentarVender(e, q, p) || mudou;
    if (e.ligado === false) return { ok: true, acao: "desligado", mudou };
    if (e.pendentes.length >= MAX_SIMULTANEAS) return { ok: true, acao: "limite de operações simultâneas", mudou };
    if (e.ultimaOp && agora - e.ultimaOp < (e.config.intervaloMin ?? 1) * 60000) return { ok: true, acao: "intervalo" };
    const total = totalBrl(e);
    if (total < 50) {
      if (!e.pendentes.length && agora - (e.avisoSemSaldo || 0) > 3600000) { e.avisoSemSaldo = agora; log(e, "Sem reais para operar.", "warn"); }
      return { ok: true, acao: e.pendentes.length ? "todo o saldo em operação" : "sem saldo", mudou };
    }
    const r = rotasPossiveis(e, q)[0];
    if (!r) {
      const m = melhorRota(e, q);
      if (m && agora - (e.ultimoProcurando || 0) > 10 * 60000) { e.ultimoProcurando = agora; log(e, `Procurando… melhor rota agora ${nome(m.a)} → ${nome(m.b)} ${pct(m.pct)} (mínimo ${nf(e.config.minimo, 2)}%)`, "faint"); }
      return { ok: true, acao: "procurando" };
    }
    comprar(e, r, false);
    if (r.retorno) log(e, `Trazendo o dinheiro de volta para a Binance: a volta custa ${RS(r.lucro)}, coberto pelo lucro guardado das idas (${R(r.credito)}).`, "acc");
    return { ok: true, acao: "comprou", rota: { a: r.a, b: r.b, valor: r.valor, lucro: r.lucro } };
  });
}

// botão "Vender agora mesmo assim": vende o USDT na hora, mesmo com prejuízo (só quando o usuário pede)
export async function venderAgora(id) {
  const { e: e0 } = await lerEstado();
  const p0 = (e0.pendentes || []).find(x => !id || x.id === +id);
  if (!p0) throw new Error("não há operação em andamento");
  const q = await precos([p0.b]);
  if (!q[p0.b]) throw new Error(`sem preço agora da ${nome(p0.b)}`);
  return alterar(e => {
    const p = e.pendentes.find(x => x.id === p0.id);
    if (!p) return { ok: false, semGravar: true, erro: "essa operação já terminou" };
    const x = venderEm(e, q, p.b, p.chega);
    if (!x) return { ok: false, semGravar: true, erro: "livro de ofertas curto para vender agora" };
    const agora = Date.now(), lucro = x.final - p.valor;
    e.saldos[p.b].usdt -= p.chega; e.saldos[p.b].brl += x.final;
    e.hist.unshift({ id: p.id, t: agora, a: p.a, b: p.b, valor: p.valor, usdt: p.chega, compra: p.medioCompra, venda: x.v.medio,
      taxas: (p.taxaA + p.saque) * p.medioCompra + x.v.rec * x.fb, lucro, pct: lucro / p.valor * 100, previsto: p.previsto,
      auto: !p.manual, final: x.final, modo: "transferir", servidor: true, duracao: agora - p.inicio, via: p.via || null, forcada: true });
    log(e, `Venda forçada por você: ${nome(p.a)} → ${nome(p.b)} · ${RS(lucro)} (${pct(lucro / p.valor * 100)}). Dinheiro de volta em reais na ${nome(p.b)}.`, lucro >= 0 ? "good" : "warn");
    e.ultimaOp = agora;
    e.pendentes = e.pendentes.filter(y => y !== p);
    creditar(e, p, lucro);
    return { ok: true, lucro, final: x.final, b: p.b };
  });
}

// botão Executar (manual)
export async function executarManual(a, b, valorPedido) {
  if (!(a in BRL) || !(b in BRL) || a === b) throw new Error("rota inválida");
  const q = await precos([a, b]);
  if (!q[a] || !q[b]) throw new Error(`sem preço agora da ${!q[a] ? nome(a) : nome(b)}`);
  return alterar(e => {
    const total = totalBrl(e);
    if (e.pendentes.length >= MAX_SIMULTANEAS) return { ok: false, semGravar: true, erro: `já há ${MAX_SIMULTANEAS} operações em andamento. Espere uma terminar.` };
    if (total < 50 && e.pendentes.length) return { ok: false, semGravar: true, erro: "todo o saldo está em operações em andamento. Espere uma terminar." };
    const saldoA = e.saldos[a].brl;
    const valor = Math.floor(Math.min(+valorPedido || e.config.max, saldoA) * 100) / 100;
    if (valor < 50) return { ok: false, semGravar: true, erro: `sem reais na ${nome(a)} (${R(saldoA)}). Igual ao real: o dinheiro só sai de onde ele está.` };
    let r = calcRota(e.config, a, b, valor, q[a], q[b]);
    if (r.faltou) return { ok: false, semGravar: true, erro: "não há ofertas suficientes no livro para esse valor" };
    const credito = e.credito || 0;
    const volta = a !== CASA && b === CASA && r.lucro + credito >= 0;
    if (!volta && (r.lucro <= 0 || r.pct < e.config.minimo)) return { ok: false, semGravar: true, erro: `essa rota agora daria ${RS(r.lucro)} (${pct(r.pct)}), abaixo do mínimo de ${nf(e.config.minimo, 2)}%. Para proteger o saldo, não executei.` };
    if (volta && !(r.lucro > 0 && r.pct >= e.config.minimo)) r = { ...r, retorno: true, credito };
    const p = comprar(e, r, true);
    return { ok: true, rota: { id: p.id, a, b, valor, lucro: r.lucro, pct: r.pct, chegaEm: p.chegaEm } };
  });
}
