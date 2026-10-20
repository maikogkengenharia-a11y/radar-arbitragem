// Robô REAL de arbitragem USDT/BRL
//   Rota A: reais na Binance -> compra USDT -> saca pela Polygon -> vende USDT por BRLA na KyberSwap
//   Rota B: BRLA na carteira -> compra USDT na KyberSwap -> deposita na Binance -> vende USDT por reais
// Regras: só entra com lucro >= mínimo; nunca vende no prejuízo (segura até dar lucro).
// Modos: "observar" (só registra o que faria) e "real" (opera de verdade).
// Segredos ficam só no servidor: /etc/robo/config.env e /etc/robo/carteira.key
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { ethers } from "ethers";
import { radar, NOME } from "./radar.mjs";

const CONF = process.env.ROBO_CONF || "/etc/robo";
const DADOS = process.env.ROBO_DADOS || "/var/lib/robo";
const ARQ = `${DADOS}/estado.json`;
const PORTA = Number(process.env.PORTA || 80);

const USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // 6 casas
const BRLA = "0xE6A537a407488807F0bbeb0038B79004f19DDDFb"; // 18 casas, 1 BRLA = R$ 1
const DEC = { [USDT]: 6, [BRLA]: 18 };
const RPCS = ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org", "https://polygon-rpc.com", "https://1rpc.io/matic"];
const KY = "https://aggregator-api.kyberswap.com/polygon/api/v1";
const KY_ID = "mesa-arbitragem";
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];
// único destino permitido para saques: a carteira da Picnic do Maiko (BRLA na Polygon, depois Pix grátis)
const PICNIC = "0xe179c4369bab7A1Cd67562347ee5d35b01DEdE28";
const GAS_BRL = 0.10;   // folga em reais para o gás de cada transação na Polygon (na prática custa centavos)
const POL_MINIMO = 0.5; // abaixo disso o robô não começa operação (precisa de POL para pagar o gás)

const dorme = ms => new Promise(r => setTimeout(r, ms));
const agora = () => Date.now();
const r2 = x => Math.round(x * 100) / 100;
const msg = e => String(e?.shortMessage || e?.message || e).slice(0, 220);

// ---------------------------------------------------------------- configuração e estado
function lerEnv() {
  const o = {};
  try {
    for (const l of fs.readFileSync(`${CONF}/config.env`, "utf8").split("\n")) {
      const m = l.match(/^([A-Z_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].trim();
    }
  } catch {}
  return o;
}
let ENV = lerEnv();
const CARTEIRA = new ethers.Wallet(fs.readFileSync(`${CONF}/carteira.key`, "utf8").trim());

// autoPicnic: no fim de cada operação, o BRLA da carteira do robô vai sozinho para a Picnic (o dinheiro fica sempre na Binance ou na Picnic)
const CONFIG_PADRAO = { max: 200, minimo: 0.02, minValor: 20, intervaloSeg: 15, pausaEntreOpsSeg: 60, autoPicnic: true };
const PADRAO = { ligado: false, modo: "observar", config: CONFIG_PADRAO, op: null, hist: [], simulados: [], log: [], aval: null, saldos: null, fimUltimaOp: 0, radar: null, radarStats: {}, radarDesde: 0 };
fs.mkdirSync(DADOS, { recursive: true });
let E;
try { E = { ...structuredClone(PADRAO), ...JSON.parse(fs.readFileSync(ARQ, "utf8")) }; }
catch { E = structuredClone(PADRAO); }
E.config = { ...CONFIG_PADRAO, ...E.config };

function salvar() {
  E.atualizado = agora();
  fs.writeFileSync(ARQ + ".tmp", JSON.stringify(E));
  fs.renameSync(ARQ + ".tmp", ARQ);
}
function log(texto, tipo = "info") {
  const ult = E.log[0];
  if (ult && ult.msg === texto && agora() - ult.t < 10 * 60e3) return; // não repete a mesma mensagem toda hora
  E.log.unshift({ t: agora(), msg: texto, tipo });
  E.log = E.log.slice(0, 200);
  console.log(new Date().toISOString(), tipo, texto);
  salvar();
}

// ---------------------------------------------------------------- utilidades de arredondamento
const casas = p => Math.max(0, Math.round(-Math.log10(p)));
const baixo = (x, p) => +(Math.floor(x / p + 1e-9) * p).toFixed(casas(p));
const cima = (x, p) => +(Math.ceil(x / p - 1e-9) * p).toFixed(casas(p));
const cache = {};
async function guardado(nome, ms, fn) {
  const c = cache[nome];
  if (c && agora() - c.t < ms) return c.v;
  const v = await fn();
  cache[nome] = { t: agora(), v };
  return v;
}

// ---------------------------------------------------------------- Binance
async function bn(metodo, caminho, params = {}, assinado = true) {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  if (assinado) {
    if (!ENV.BINANCE_KEY || !ENV.BINANCE_SECRET) throw new Error("chaves da Binance ainda não configuradas (rode robo-config no servidor)");
    q.set("timestamp", String(Date.now()));
    q.set("recvWindow", "10000");
    q.set("signature", crypto.createHmac("sha256", ENV.BINANCE_SECRET).update(q.toString()).digest("hex"));
  }
  const r = await fetch(`https://api.binance.com${caminho}?${q}`, {
    method: metodo,
    headers: ENV.BINANCE_KEY ? { "X-MBX-APIKEY": ENV.BINANCE_KEY } : {},
    signal: AbortSignal.timeout(12000),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) {
    const e = new Error(`Binance: ${d?.msg || t}`.slice(0, 220));
    e.codigo = d?.code;
    throw e;
  }
  return d;
}
const regras = () => guardado("regras", 3600e3, async () => {
  const d = await bn("GET", "/api/v3/exchangeInfo", { symbol: "USDTBRL" }, false);
  const f = Object.fromEntries(d.symbols[0].filters.map(x => [x.filterType, x]));
  return {
    tick: +f.PRICE_FILTER.tickSize, passo: +f.LOT_SIZE.stepSize, minQtd: +f.LOT_SIZE.minQty,
    minNocional: +(f.NOTIONAL?.minNotional ?? f.MIN_NOTIONAL?.minNotional ?? 10),
  };
});
const taxa = () => guardado("taxa", 3600e3, async () => {
  try { const d = await bn("GET", "/sapi/v1/asset/tradeFee", { symbol: "USDTBRL" }); return +d[0].takerCommission; }
  catch { return 0.001; }
});
const rede = () => guardado("rede", 600e3, async () => {
  const d = await bn("GET", "/sapi/v1/capital/config/getall");
  const lista = d.find(c => c.coin === "USDT")?.networkList || [];
  const n = lista.find(x => ["MATIC", "POL"].includes(x.network)) || lista.find(x => /polygon\s*pos/i.test(x.name || ""));
  if (!n) throw new Error("Binance: rede Polygon do USDT não encontrada");
  return {
    rede: n.network, taxa: +n.withdrawFee, min: +n.withdrawMin,
    multiplo: +n.withdrawIntegerMultiple > 0 ? +n.withdrawIntegerMultiple : 0.000001,
    saqueOk: !!n.withdrawEnable, depositoOk: !!n.depositEnable,
  };
});
async function livro() {
  const d = await bn("GET", "/api/v3/depth", { symbol: "USDTBRL", limit: 50 }, false);
  return { asks: d.asks.map(([p, q]) => [+p, +q]), bids: d.bids.map(([p, q]) => [+p, +q]) };
}
// gasta "brl" reais comprando USDT pelo livro
function gastar(asks, brl) {
  let usdt = 0, resto = brl, ultimo = 0;
  for (const [p, q] of asks) {
    ultimo = p;
    if (p * q >= resto) { usdt += resto / p; resto = 0; break; }
    usdt += q; resto -= p * q;
  }
  return resto > 1e-9 ? null : { usdt, ultimo };
}
// vende "usdt" pelo livro
function vender(bids, usdt) {
  let brl = 0, resto = usdt, ultimo = 0;
  for (const [p, q] of bids) {
    const x = Math.min(q, resto);
    brl += x * p; resto -= x; ultimo = p;
    if (resto <= 1e-12) break;
  }
  return resto > 1e-9 ? null : { brl, ultimo };
}
async function saldosBinance() {
  const d = await bn("GET", "/api/v3/account", { omitZeroBalances: true });
  const s = { BRL: 0, USDT: 0 };
  for (const b of d.balances) if (b.asset in s) s[b.asset] = +b.free;
  return s;
}
// soma o que a ordem realmente executou (já descontando a taxa)
async function resultadoOrdem(orderId) {
  const ts = await bn("GET", "/api/v3/myTrades", { symbol: "USDTBRL", orderId });
  let usdt = 0, brl = 0;
  for (const t of ts) {
    usdt += +t.qty; brl += +t.quoteQty;
    if (t.commissionAsset === "USDT") usdt -= +t.commission;
    if (t.commissionAsset === "BRL") brl -= +t.commission;
  }
  return { usdt, brl };
}
async function ordemExistente(clientId) {
  try { return await bn("GET", "/api/v3/order", { symbol: "USDTBRL", origClientOrderId: clientId }); }
  catch (e) { if (e.codigo === -2013) return null; throw e; }
}

// ---------------------------------------------------------------- Polygon (carteira do robô)
const provedores = RPCS.map(u => new ethers.JsonRpcProvider(u, 137, { staticNetwork: true }));
let rpcI = 0;
const prov = () => provedores[rpcI % provedores.length];
async function comRpc(fn) {
  let ult;
  for (let i = 0; i < provedores.length; i++) {
    try { return await fn(prov()); }
    catch (e) { if (e?.code === "CALL_EXCEPTION") throw e; ult = e; rpcI++; }
  }
  throw ult;
}
const saldoToken = (t, quem = CARTEIRA.address) => comRpc(p => new ethers.Contract(t, ERC20, p).balanceOf(quem));
async function saldosCarteira() {
  const [u, b, pol] = await Promise.all([saldoToken(USDT), saldoToken(BRLA), comRpc(p => p.getBalance(CARTEIRA.address))]);
  return { USDT: +ethers.formatUnits(u, 6), BRLA: +ethers.formatUnits(b, 18), POL: +ethers.formatEther(pol), usdtWei: u, brlaWei: b };
}
async function taxasGas(p) {
  const f = await p.getFeeData();
  const minPrio = ethers.parseUnits("35", "gwei");
  const prio = f.maxPriorityFeePerGas && f.maxPriorityFeePerGas > minPrio ? f.maxPriorityFeePerGas : minPrio;
  const base = f.maxFeePerGas || f.gasPrice || ethers.parseUnits("200", "gwei");
  return { maxPriorityFeePerGas: prio, maxFeePerGas: base * 2n + prio };
}
// assina sem enviar: assim o robô guarda o "recibo" antes, e não duplica nada se reiniciar no meio
async function assinar(req) {
  return comRpc(async p => {
    const gas = await p.estimateGas({ ...req, from: CARTEIRA.address }); // se a troca não for dar o mínimo, falha aqui sem gastar nada
    const nonce = await p.getTransactionCount(CARTEIRA.address, "pending");
    const tx = { ...req, gasLimit: (gas * 13n) / 10n, nonce, chainId: 137n, type: 2, ...(await taxasGas(p)) };
    const assinada = await CARTEIRA.signTransaction(tx);
    return { hash: ethers.keccak256(assinada), assinada };
  });
}
async function transmitir(assinada) {
  for (let i = 0; i < provedores.length; i++) {
    try { await prov().broadcastTransaction(assinada); return; }
    catch (e) {
      if (/already known|nonce too low|known transaction|ALREADY_EXISTS/i.test(msg(e))) return;
      rpcI++;
      if (i === provedores.length - 1) throw e;
    }
  }
}
async function recibo(hash) {
  try { return await prov().getTransactionReceipt(hash); } catch { rpcI++; return null; }
}
async function esperarRecibo(hash, maxMs = 120000) {
  const fim = agora() + maxMs;
  while (agora() < fim) { const r = await recibo(hash); if (r) return r; await dorme(4000); }
  return null;
}
async function garantirPermissao(token, roteador, wei) {
  const c = new ethers.Contract(token, ERC20, CARTEIRA);
  const atual = await comRpc(p => c.connect(p).allowance(CARTEIRA.address, roteador));
  if (atual >= wei) return;
  log(`Liberando ${token === USDT ? "USDT" : "BRLA"} para a KyberSwap (só na primeira vez)`);
  const { hash, assinada } = await assinar({ to: token, data: c.interface.encodeFunctionData("approve", [roteador, ethers.MaxUint256]), value: 0n });
  await transmitir(assinada);
  const r = await esperarRecibo(hash, 180000);
  if (!r || r.status !== 1) throw new Error("a liberação do token na KyberSwap não confirmou");
}

// ---------------------------------------------------------------- KyberSwap
async function kyRota(de, para, qtd) {
  const wei = typeof qtd === "bigint" ? qtd : ethers.parseUnits(Math.max(0, qtd).toFixed(DEC[de]), DEC[de]);
  const r = await fetch(`${KY}/routes?tokenIn=${de}&tokenOut=${para}&amountIn=${wei}`, {
    headers: { "X-Client-Id": KY_ID, Accept: "application/json" }, signal: AbortSignal.timeout(10000),
  });
  const d = await r.json().catch(() => null);
  if (!d?.data?.routeSummary) throw new Error("KyberSwap sem rota: " + (d?.message || r.status));
  return { wei, resumo: d.data.routeSummary, saida: +ethers.formatUnits(d.data.routeSummary.amountOut, DEC[para]) };
}
async function kyMontar(resumo, slipBps) {
  const r = await fetch(`${KY}/route/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": KY_ID },
    body: JSON.stringify({
      routeSummary: resumo, sender: CARTEIRA.address, recipient: CARTEIRA.address,
      slippageTolerance: slipBps, deadline: Math.floor(agora() / 1000) + 600, source: KY_ID,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json().catch(() => null);
  if (!d?.data?.data) throw new Error("KyberSwap não montou a troca: " + (d?.message || r.status));
  return d.data;
}
// tenta trocar "wei" de "de" por "para" recebendo no mínimo "minSaida". Devolve null se agora não compensa.
async function iniciarTroca(op, de, para, wei, minSaida) {
  const rota = await kyRota(de, para, wei);
  op.cotacao = rota.saida;
  if (rota.saida < minSaida) return null;
  const slip = Math.max(0, Math.min(50, Math.floor(((rota.saida - minSaida) / rota.saida) * 10000)));
  const m = await kyMontar(rota.resumo, slip);
  await garantirPermissao(de, m.routerAddress, wei);
  op.antes = (await saldoToken(para)).toString();
  let s;
  try { s = await assinar({ to: m.routerAddress, data: m.data, value: 0n }); }
  catch (e) { if (e?.code === "CALL_EXCEPTION") return null; throw e; } // o preço mudou: a troca daria menos que o mínimo
  op.tx = s.hash; op.txAssinada = s.assinada; op.txEm = agora(); op.minSaida = minSaida;
  salvar();
  await transmitir(s.assinada);
  return s.hash;
}
// confere a troca enviada. Devolve: {ok, saida} | {falhou} | null (ainda esperando)
async function conferirTroca(op, para) {
  const r = await recibo(op.tx);
  if (!r) {
    const espera = agora() - op.txEm;
    if (espera > 30 * 60e3) { log("Transação sumiu da rede; vou tentar de novo", "aviso"); return { falhou: true }; }
    if (espera > 3 * 60e3 && !op.reenviada) { op.reenviada = true; await transmitir(op.txAssinada).catch(() => {}); }
    return null;
  }
  if (r.status !== 1) return { falhou: true };
  const depois = await saldoToken(para);
  const saida = +ethers.formatUnits(depois - BigInt(op.antes), DEC[para]);
  const gasPol = +ethers.formatEther(r.gasUsed * (r.gasPrice ?? r.effectiveGasPrice ?? 0n));
  return { ok: true, saida, gasPol };
}
function limparTx(op) { delete op.tx; delete op.txAssinada; delete op.txEm; delete op.reenviada; delete op.antes; }

// ---------------------------------------------------------------- avaliação (quanto daria agora)
// quanto daria agora uma rota com um valor específico
async function calcRota(tipo, valor, L, fee, N) {
  if (tipo === "A") {
    const g = gastar(L.asks, valor);
    const u = g ? g.usdt * (1 - fee) - N.taxa : 0;
    if (u <= 0) return null;
    const k = await kyRota(USDT, BRLA, u);
    const lucro = k.saida - valor - GAS_BRL;
    return { valor, usdt: u, recebe: k.saida, lucro, pct: (lucro / valor) * 100 };
  }
  const k = await kyRota(BRLA, USDT, valor);
  const s = vender(L.bids, k.saida);
  if (!s) return null;
  const brl = s.brl * (1 - fee);
  const lucro = brl - valor - GAS_BRL * 2;
  return { valor, usdt: k.saida, recebe: brl, lucro, pct: (lucro / valor) * 100 };
}
const saldoRota = tipo => tipo === "A" ? (E.saldos?.binance?.BRL ?? 0) : (E.saldos?.carteira?.BRLA ?? 0);

async function avaliar() {
  const [L, fee] = await Promise.all([livro(), taxa()]);
  const N = await rede().catch(() => ({ taxa: 0.03 }));
  const cfg = E.config;
  const out = { t: agora(), taxa: fee, saque: N.taxa, ask: L.asks[0]?.[0], bid: L.bids[0]?.[0] };
  for (const tipo of ["A", "B"]) {
    const real = Math.floor(Math.min(cfg.max, saldoRota(tipo)) * 100) / 100;
    const v = real >= cfg.minValor ? real : cfg.max;
    const r = await calcRota(tipo, v, L, fee, N).catch(() => null);
    if (r) out[tipo] = { ...r, hipotetico: real < cfg.minValor || (tipo === "B" && cfg.autoPicnic) };
  }
  return out;
}

// ---------------------------------------------------------------- operação: etapas
const ROTULO = {
  comprar: "Comprando USDT na Binance",
  sacar: "Sacando USDT para a carteira (Polygon)",
  chegando: "Esperando o USDT chegar na carteira",
  vender: "Vendendo USDT por BRLA na KyberSwap",
  vender_conf: "Confirmando a venda na Polygon",
  trocarB: "Comprando USDT com BRLA na KyberSwap",
  trocarB_conf: "Confirmando a compra na Polygon",
  depositar: "Enviando USDT para a Binance",
  depositar_conf: "Confirmando o envio na Polygon",
  creditando: "Esperando a Binance creditar o USDT",
  vender_binance: "Vendendo USDT por reais na Binance",
};

// avisa no máximo a cada 10 minutos enquanto segura (para não lotar o registro)
function segurando(op, texto) {
  if (!op.segurandoDesde) op.segurandoDesde = agora();
  op.segurandoMsg = texto;
  if (!op.avisoEm || agora() - op.avisoEm > 10 * 60e3) { op.avisoEm = agora(); log(texto, "aviso"); }
}

function finalizar(op, recebido, extra = {}) {
  const lucro = recebido - op.custo;
  const h = {
    id: op.id, tipo: op.tipo, t: agora(), inicio: op.inicio, duracaoSeg: Math.round((agora() - op.inicio) / 1000),
    entrou: r2(op.custo), saiu: r2(recebido), lucro: r2(lucro), pct: +((lucro / op.custo) * 100).toFixed(3),
    previsto: op.previsto, gasPol: +(op.gasPol || 0).toFixed(4), manual: !!op.manual,
    usdt: +(op.tipo === "A" ? op.usdtChegou || op.usdtComprado || 0 : op.usdt || 0).toFixed(4), ...extra,
  };
  E.hist.unshift(h); E.hist = E.hist.slice(0, 500);
  E.op = null; E.fimUltimaOp = agora();
  if (E.config.autoPicnic) E.enviarPicnic = true;
  log(`Operação ${op.tipo === "A" ? "Binance → Carteira" : "Carteira → Binance"} concluída: entrou R$ ${h.entrou}, saiu R$ ${h.saiu}, lucro R$ ${h.lucro} (${h.pct}%)`, lucro >= 0 ? "lucro" : "aviso");
}

async function avancar(op) {
  const etapaAntes = op.etapa;
  switch (op.etapa) {
    // ---------------- ROTA A
    case "comprar": {
      const R = await regras();
      let o = await ordemExistente(op.id);
      if (!o) {
        const L = await livro();
        const g = gastar(L.asks, op.valor);
        if (!g) throw new Error("livro da Binance sem ofertas suficientes");
        const preco = cima(g.ultimo, R.tick);
        const qtd = baixo(op.valor / preco, R.passo);
        o = await bn("POST", "/api/v3/order", {
          symbol: "USDTBRL", side: "BUY", type: "LIMIT", timeInForce: "IOC",
          price: preco, quantity: qtd, newClientOrderId: op.id,
        });
      }
      if (!["FILLED", "EXPIRED", "CANCELED", "EXPIRED_IN_MATCH"].includes(o.status)) return; // ainda processando
      const res = await resultadoOrdem(o.orderId);
      if (res.usdt <= 0) { log("O preço mudou antes da compra; nada foi comprado. Operação cancelada.", "aviso"); E.op = null; E.fimUltimaOp = agora(); return; }
      op.custo = res.brl; op.usdtComprado = res.usdt;
      log(`Comprou ${res.usdt.toFixed(4)} USDT por R$ ${r2(res.brl)} na Binance`);
      op.etapa = "sacar";
      break;
    }
    case "sacar": {
      const N = await rede();
      if (!N.saqueOk) { log("Binance está com saques de USDT pela Polygon pausados; aguardando", "aviso"); return; }
      const wid = op.wid || op.id;
      const hist = await bn("GET", "/sapi/v1/capital/withdraw/history", { coin: "USDT", withdrawOrderId: wid });
      if (!hist.length) {
        const livre = (await saldosBinance()).USDT;
        const qtd = baixo(Math.min(op.usdtComprado, livre), N.multiplo);
        if (qtd < N.min) throw new Error(`valor abaixo do saque mínimo da Binance (${N.min} USDT)`);
        op.usdtAntes = (await saldosCarteira()).USDT;
        await bn("POST", "/sapi/v1/capital/withdraw/apply", {
          coin: "USDT", network: N.rede, address: CARTEIRA.address, amount: qtd, withdrawOrderId: wid,
        });
        op.saque = qtd; op.taxaSaque = N.taxa;
        log(`Saque de ${qtd} USDT pedido na Binance (taxa ${N.taxa} USDT)`);
      }
      op.etapa = "chegando";
      break;
    }
    case "chegando": {
      const [w] = await bn("GET", "/sapi/v1/capital/withdraw/history", { coin: "USDT", withdrawOrderId: op.wid || op.id });
      if (!w) return;
      if ([1, 3, 5].includes(+w.status)) {
        log("A Binance recusou/cancelou o saque. O USDT ficou na Binance: vou vendê-lo de volta só quando não der prejuízo.", "aviso");
        op.usdtBinance = op.usdtComprado; op.brlAcum = op.brlAcum || 0; op.n = op.n || 0;
        op.etapa = "vender_binance";
        break;
      }
      if (+w.status !== 6) return; // ainda processando
      op.txSaque = w.txId;
      const esperado = op.saque - op.taxaSaque;
      const c = await saldosCarteira();
      const chegou = c.USDT - (op.usdtAntes || 0);
      if (chegou < esperado * 0.98) return; // a rede ainda não mostrou o saldo novo
      op.usdtChegou = Math.min(chegou, op.saque);
      log(`Chegaram ${op.usdtChegou.toFixed(4)} USDT na carteira do robô`);
      op.etapa = "vender";
      break;
    }
    case "vender": {
      const c = await saldosCarteira();
      const quer = ethers.parseUnits(op.usdtChegou.toFixed(6), 6);
      const wei = quer < c.usdtWei ? quer : c.usdtWei;
      if (wei <= 0n) throw new Error("carteira sem USDT para vender");
      const falta = op.custo - (op.brlAcum || 0);
      let minimo = falta + GAS_BRL; // nunca abaixo do que custou
      if (op.forcar) { const q = await kyRota(USDT, BRLA, wei); minimo = q.saida * 0.995; } // venda forçada: aceita o preço de agora (no máx. 0,5% pior)
      const h = await iniciarTroca(op, USDT, BRLA, wei, minimo);
      if (!h) {
        // caminho alternativo: mandar o USDT para a Binance e vender lá, se der lucro
        if (!op.redirecionado && !op.forcar) {
          const [L, fee] = await Promise.all([livro(), taxa()]);
          const u = +ethers.formatUnits(wei, 6), v = vender(L.bids, u);
          const brl = v ? v.brl * (1 - fee) : 0;
          if (brl >= falta + GAS_BRL * 2) {
            op.redirecionado = true; op.usdt = u; delete op.cotacao;
            log(`Redirecionando: vender na KyberSwap daria prejuízo, mas na Binance dá R$ ${r2(brl)} (custo R$ ${r2(falta)}). Mandando o USDT para a Binance.`, "op");
            op.etapa = "depositar";
            break;
          }
        }
        segurando(op, `Segurando USDT: a venda agora daria R$ ${r2(op.cotacao)} e o custo foi R$ ${r2(falta)}. Espero o preço melhorar (ou a Binance pagar mais).`);
        return;
      }
      op.etapa = "vender_conf";
      break;
    }
    case "vender_conf": {
      const r = await conferirTroca(op, BRLA);
      if (!r) return;
      if (r.falhou) { limparTx(op); op.etapa = "vender"; break; }
      op.gasPol = (op.gasPol || 0) + r.gasPol;
      limparTx(op);
      finalizar(op, r.saida + (op.brlAcum || 0), op.redirecionado ? { redirecionado: true } : {});
      return;
    }
    // ---------------- ROTA B
    case "trocarB": {
      const [L, fee] = await Promise.all([livro(), taxa()]);
      const wei = ethers.parseUnits(op.custo.toFixed(18), 18);
      const c = await saldosCarteira();
      if (c.brlaWei < wei) { log("Carteira com menos BRLA que o previsto; operação cancelada", "aviso"); E.op = null; return; }
      const rota = await kyRota(BRLA, USDT, wei);
      const s = vender(L.bids, rota.saida);
      const brl = s ? s.brl * (1 - fee) : 0;
      const precisa = op.custo + GAS_BRL * 2;
      if (brl < precisa) { log("A oportunidade sumiu antes de começar; operação cancelada (nada foi gasto)", "aviso"); E.op = null; E.fimUltimaOp = agora(); return; }
      const minUsdt = rota.saida * (precisa / brl);
      const h = await iniciarTroca(op, BRLA, USDT, wei, minUsdt);
      if (!h) { log("Preço mudou na KyberSwap; operação cancelada (nada foi gasto)", "aviso"); E.op = null; E.fimUltimaOp = agora(); return; }
      op.etapa = "trocarB_conf";
      break;
    }
    case "trocarB_conf": {
      const r = await conferirTroca(op, USDT);
      if (!r) return;
      if (r.falhou) { limparTx(op); log("Troca não confirmou; operação cancelada", "aviso"); E.op = null; E.fimUltimaOp = agora(); return; }
      op.gasPol = (op.gasPol || 0) + r.gasPol;
      op.usdt = r.saida;
      limparTx(op);
      log(`Comprou ${r.saida.toFixed(4)} USDT com R$ ${r2(op.custo)} em BRLA`);
      op.etapa = "depositar";
      break;
    }
    case "depositar": {
      const N = await rede();
      if (!N.depositoOk) { log("Binance está com depósitos de USDT pela Polygon pausados; aguardando", "aviso"); return; }
      const d = await bn("GET", "/sapi/v1/capital/deposit/address", { coin: "USDT", network: N.rede });
      if (!ethers.isAddress(d.address)) throw new Error("endereço de depósito da Binance inválido");
      const c = new ethers.Contract(USDT, ERC20);
      const wei = ethers.parseUnits(op.usdt.toFixed(6), 6);
      const s = await assinar({ to: USDT, data: c.interface.encodeFunctionData("transfer", [d.address, wei]), value: 0n });
      op.tx = s.hash; op.txAssinada = s.assinada; op.txEm = agora(); op.txDeposito = s.hash;
      salvar();
      await transmitir(s.assinada);
      op.etapa = "depositar_conf";
      break;
    }
    case "depositar_conf": {
      const r = await recibo(op.tx);
      if (!r) {
        if (agora() - op.txEm > 3 * 60e3 && !op.reenviada) { op.reenviada = true; await transmitir(op.txAssinada).catch(() => {}); }
        return;
      }
      if (r.status !== 1) { limparTx(op); op.etapa = "depositar"; break; }
      op.gasPol = (op.gasPol || 0) + +ethers.formatEther(r.gasUsed * (r.gasPrice ?? 0n));
      limparTx(op);
      log(`USDT enviado para a Binance; esperando crédito`);
      op.etapa = "creditando";
      break;
    }
    case "creditando": {
      const lista = await bn("GET", "/sapi/v1/capital/deposit/hisrec", { coin: "USDT", limit: 50 });
      const d = lista.find(x => String(x.txId || "").toLowerCase() === op.txDeposito.toLowerCase());
      if (!d || ![1, 6].includes(+d.status)) return;
      op.usdtBinance = +d.amount; op.brlAcum = op.brlAcum || 0; op.n = op.n || 0;
      log(`Binance creditou ${d.amount} USDT`);
      op.etapa = "vender_binance";
      break;
    }
    case "vender_binance": {
      const [R, fee] = await Promise.all([regras(), taxa()]);
      const cid = `${op.id}v${op.n}`;
      let o = await ordemExistente(cid);
      if (!o) {
        const livre = (await saldosBinance()).USDT;
        const qtd = baixo(Math.min(op.usdtBinance, livre), R.passo);
        const falta = op.custo - op.brlAcum;
        const L = await livro();
        const melhor = L.bids[0]?.[0] || 0;
        if (qtd < R.minQtd || qtd * melhor < R.minNocional) { // sobra pequena demais para a Binance aceitar
          finalizar(op, op.brlAcum, { sobraUsdt: +op.usdtBinance.toFixed(4) });
          return;
        }
        let precoMin = cima(falta / (qtd * (1 - fee)), R.tick); // vender abaixo disso daria prejuízo
        if (op.forcar) precoMin = baixo(melhor * 0.997, R.tick); // venda forçada: preço de agora
        if (melhor < precoMin) {
          // caminho alternativo: sacar para a carteira e vender por BRLA na KyberSwap, se der lucro
          if (!op.redirecionado && !op.forcar) {
            const N = await rede().catch(() => null);
            const chega = N ? qtd - N.taxa : 0;
            const k = chega > 0 && N && N.saqueOk ? await kyRota(USDT, BRLA, chega).catch(() => null) : null;
            if (k && k.saida >= falta + GAS_BRL) {
              op.redirecionado = true; op.usdtComprado = qtd; op.wid = `${op.id}r`;
              log(`Redirecionando: vender na Binance daria prejuízo, mas na KyberSwap dá R$ ${r2(k.saida)} (custo R$ ${r2(falta)}). Sacando o USDT para a carteira.`, "op");
              op.etapa = "sacar";
              if (E.op && op.etapa !== "vender_binance") { op.etapaEm = agora(); delete op.segurandoDesde; delete op.segurandoMsg; delete op.avisoEm; }
              return;
            }
          }
          segurando(op, `Segurando ${qtd} USDT na Binance: o melhor preço agora é R$ ${melhor} e preciso de pelo menos R$ ${precoMin} para não ter prejuízo.`);
          return;
        }
        o = await bn("POST", "/api/v3/order", {
          symbol: "USDTBRL", side: "SELL", type: "LIMIT", timeInForce: "IOC",
          price: precoMin, quantity: qtd, newClientOrderId: cid,
        });
      }
      if (!["FILLED", "EXPIRED", "CANCELED", "EXPIRED_IN_MATCH"].includes(o.status)) return;
      const res = await resultadoOrdem(o.orderId);
      op.n++;
      op.brlAcum += res.brl; op.usdtBinance -= +o.executedQty;
      if (res.brl > 0) log(`Vendeu ${(+o.executedQty).toFixed(4)} USDT por R$ ${r2(res.brl)} na Binance`);
      if (op.usdtBinance < R.minQtd || op.brlAcum >= op.custo || (op.forcar && op.n >= 3)) finalizar(op, op.brlAcum, op.usdtBinance > 1e-6 ? { sobraUsdt: +op.usdtBinance.toFixed(4) } : {});
      return;
    }
    default:
      throw new Error("etapa desconhecida: " + op.etapa);
  }
  if (E.op && op.etapa !== etapaAntes) { op.etapaEm = agora(); delete op.segurandoDesde; delete op.segurandoMsg; delete op.avisoEm; delete op.erro; }
}

// ---------------------------------------------------------------- ciclo principal
async function atualizarSaldos() {
  const s = { t: agora() };
  try { s.carteira = await saldosCarteira(); delete s.carteira.usdtWei; delete s.carteira.brlaWei; }
  catch (e) { s.erroCarteira = msg(e); }
  if (ENV.BINANCE_KEY) {
    try { s.binance = await saldosBinance(); } catch (e) { s.erroBinance = msg(e); }
  }
  E.saldos = s;
}

function novaOp(tipo, a) {
  const id = `${tipo.toLowerCase()}${agora().toString(36)}`;
  return {
    id, tipo, inicio: agora(), etapaEm: agora(),
    etapa: tipo === "A" ? "comprar" : "trocarB",
    valor: a.valor, custo: a.valor, previsto: { lucro: r2(a.lucro), pct: +a.pct.toFixed(3) }, manual: !!a.manual,
  };
}

// radar de todas as corretoras: a cada 30 s, e conta quantas vezes cada rota passou do lucro mínimo
let radarEm = 0;
async function rodarRadar() {
  if (agora() - radarEm < 30e3) return;
  radarEm = agora();
  const R = await radar(E.config.max);
  E.radar = { ...R, rotas: R.rotas.slice(0, 15) };
  if (!E.radarDesde) E.radarDesde = agora();
  for (const r of R.rotas) {
    const k = `${r.a}>${r.b}`;
    const st = E.radarStats[k] || (E.radarStats[k] = { a: r.a, b: r.b, vezes: 0, melhor: -99, ultima: 0, soma: 0 });
    if (r.pct > st.melhor) st.melhor = r.pct;
    if (r.pct >= E.config.minimo && r.lucro > 0 && agora() - st.ultima > 60e3) { st.vezes++; st.ultima = agora(); st.soma = r2(st.soma + r.lucro); }
  }
}

async function ciclo() {
  ENV = lerEnv();
  try { await rodarRadar(); } catch (e) { console.log("radar:", msg(e)); }
  await atualizarSaldos();
  // o BRLA que sobrou na carteira do robô vai para a Picnic
  if (!E.op && E.config.autoPicnic && (E.enviarPicnic || (E.saldos?.carteira?.BRLA ?? 0) >= 1)) {
    if ((E.saldos?.carteira?.BRLA ?? 0) >= 1) {
      try { await sacarPicnic(); E.enviarPicnic = false; }
      catch (e) { log("Não consegui mandar o BRLA para a Picnic: " + msg(e) + " (tento de novo)", "erro"); }
    } else E.enviarPicnic = false;
  }
  if (E.op) {
    await avancar(E.op); // operação em andamento sempre vai até o fim (sem prejuízo); desligar só impede de começar outra
    return;
  }
  E.aval = await avaliar();
  const cfg = E.config;
  const cands = ["A", "B"].map(k => E.aval[k] && { tipo: k, ...E.aval[k] })
    .filter(a => a && (!a.hipotetico || E.modo === "observar") && a.lucro > 0 && a.pct >= cfg.minimo)
    .sort((x, y) => y.pct - x.pct);
  const melhor = cands[0];
  if (!E.ligado || !melhor) return;

  if (E.modo === "observar") {
    const ult = E.simulados[0];
    if (!ult || ult.tipo !== melhor.tipo || agora() - ult.t > 60e3) {
      E.simulados.unshift({ t: agora(), tipo: melhor.tipo, valor: r2(melhor.valor), lucro: r2(melhor.lucro), pct: +melhor.pct.toFixed(3) });
      E.simulados = E.simulados.slice(0, 300);
      log(`[observando] Faria ${melhor.tipo === "A" ? "Binance → Carteira" : "Carteira → Binance"} com R$ ${r2(melhor.valor)}: lucro previsto R$ ${r2(melhor.lucro)} (${melhor.pct.toFixed(3)}%)`, "sim");
    }
    return;
  }
  // modo real
  if (!ENV.BINANCE_KEY) { log("Modo real sem chaves da Binance: rode robo-config no servidor", "erro"); return; }
  if ((E.saldos?.carteira?.POL ?? 0) < POL_MINIMO) { log(`Carteira do robô com menos de ${POL_MINIMO} POL para pagar o gás. Mande uns 5 POL para ela.`, "erro"); return; }
  if (agora() - (E.fimUltimaOp || 0) < cfg.pausaEntreOpsSeg * 1000) return;
  if (E.op) return;
  E.op = novaOp(melhor.tipo, melhor);
  log(`Iniciando ${melhor.tipo === "A" ? "Binance → Carteira" : "Carteira → Binance"} com R$ ${r2(melhor.valor)} (lucro previsto R$ ${r2(melhor.lucro)}, ${melhor.pct.toFixed(3)}%)`, "op");
  salvar();
  await avancar(E.op);
}

let ultimoErro = "";
async function loop() {
  log(`Robô iniciado. Carteira ${CARTEIRA.address}. Modo: ${E.modo}, ${E.ligado ? "ligado" : "desligado"}.`);
  if (ENV.BINANCE_KEY) {
    try {
      const s = await saldosBinance();
      const r = await bn("GET", "/sapi/v1/account/apiRestrictions").catch(() => ({}));
      const faltam = [!r.enableSpotAndMarginTrading && "negociação spot", !r.enableWithdrawals && "saques", !r.ipRestrict && "restrição de IP"].filter(Boolean);
      log(`Binance conectada: R$ ${r2(s.BRL)} e ${s.USDT.toFixed(4)} USDT.` + (faltam.length ? ` ATENÇÃO, falta ativar na chave: ${faltam.join(", ")}.` : " Permissões da chave OK."), faltam.length ? "aviso" : "lucro");
    } catch (e) { log("Binance NÃO conectou: " + msg(e), "erro"); }
  }
  for (;;) {
    try { await ciclo(); ultimoErro = ""; }
    catch (e) {
      const m = msg(e);
      if (E.op) E.op.erro = m;
      if (m !== ultimoErro) log("Erro: " + m, "erro");
      ultimoErro = m;
    }
    try { salvar(); } catch {}
    await dorme(E.op && E.ligado ? 5000 : E.config.intervaloSeg * 1000);
  }
}

// ---------------------------------------------------------------- painel (HTTP, protegido por PIN)
// ---------------------------------------------------------------- formato do painel do simulador (modo real)
const ROTA_DE = { A: ["binance", "polygon"], B: ["polygon", "binance"] };
const TIPO_LOG = { lucro: "good", erro: "bad", aviso: "warn", op: "acc", sim: "faint", info: "" };
function painel() {
  const sb = E.saldos?.binance || { BRL: 0, USDT: 0 }, sc = E.saldos?.carteira || { USDT: 0, BRLA: 0, POL: 0 };
  const bid = E.aval?.bid || 5.3;
  const total = sb.BRL + sc.BRLA + (sb.USDT + sc.USDT) * bid;
  const hist = E.hist.map(h => {
    const [a, b] = ROTA_DE[h.tipo], u = h.usdt || 0;
    return { id: h.id, t: h.t, a, b, valor: h.entrou, final: h.saiu, lucro: h.lucro, pct: h.pct, previsto: h.previsto?.lucro,
      usdt: u, compra: u ? h.entrou / u : 0, venda: u ? h.saiu / u : 0, taxas: 0, auto: !h.manual, modo: "real", duracao: h.duracaoSeg };
  });
  const soma = hist.reduce((t, h) => t + h.lucro, 0);
  let pendente = null;
  if (E.op) {
    const op = E.op, [a, b] = ROTA_DE[op.tipo], usdt = op.usdtComprado || op.usdt || 0;
    pendente = {
      id: op.id, a, b, valor: op.custo, usdt, medioCompra: usdt ? op.custo / usdt : 0,
      chega: op.usdtChegou || (op.saque ? op.saque - op.taxaSaque : usdt),
      chegaEm: op.inicio + (op.tipo === "A" ? 4 : 10) * 60e3, segurandoDesde: op.segurandoDesde || null,
      etapa: op.etapa, rotulo: ROTULO[op.etapa], erro: op.erro || null, segurandoMsg: op.segurandoMsg || null, forcar: !!op.forcar,
    };
  }
  return {
    real: true, ligado: E.ligado && E.modo === "real", modo: E.modo, verificado: E.saldos?.t, atualizado: E.atualizado,
    config: { minimo: E.config.minimo, max: E.config.max }, conectadas: ENV.BINANCE_KEY ? ["binance", "polygon"] : ["polygon"],
    saldos: { binance: { brl: sb.BRL, usdt: sb.USDT }, polygon: { brl: sc.BRLA, usdt: sc.USDT } },
    aportes: total - soma, hist, log: E.log.map(l => ({ t: l.t, txt: l.msg, tipo: TIPO_LOG[l.tipo] ?? "" })),
    pendente, carteira: CARTEIRA.address, pol: sc.POL ?? 0, criado: E.radarDesde || agora(),
  };
}
// "Vender agora mesmo assim": o robô vende na hora (ou assim que o USDT chegar), mesmo com prejuízo
function venderAgoraReal() {
  const op = E.op;
  if (!op) throw new Error("não há operação em andamento");
  if (["comprar", "trocarB", "trocarB_conf"].includes(op.etapa)) throw new Error("a operação está começando agora; espere alguns segundos");
  op.forcar = true; delete op.avisoEm;
  const naHora = ["vender", "vender_binance"].includes(op.etapa);
  log(`Você pediu para vender agora, mesmo com prejuízo. ${naHora ? "Vendendo…" : "O USDT está a caminho: vende assim que chegar."}`, "op");
  salvar();
  return { ok: true, naHora, etapa: ROTULO[op.etapa] };
}

// execução de um clique pelo painel, com dinheiro real
async function executarManual(a, b, pedido) {
  const tipo = a === "binance" && b === "polygon" ? "A" : a === "polygon" && b === "binance" ? "B" : null;
  if (!tipo) throw new Error("essa rota ainda não está conectada no modo real (só Binance ↔ Carteira Polygon)");
  if (!ENV.BINANCE_KEY) throw new Error("chaves da Binance não configuradas no servidor");
  if (E.op) throw new Error("já existe uma operação em andamento; espere ela terminar");
  await atualizarSaldos();
  if ((E.saldos?.carteira?.POL ?? 0) < POL_MINIMO) throw new Error(`a carteira do robô precisa de pelo menos ${POL_MINIMO} POL para o gás`);
  const saldo = saldoRota(tipo);
  const valor = Math.floor(Math.min(Number(pedido) || E.config.max, saldo) * 100) / 100;
  if (valor < E.config.minValor) throw new Error(tipo === "A" ? `saldo em reais na Binance insuficiente (R$ ${r2(saldo)})` : `pouco BRLA na carteira do robô (R$ ${r2(saldo)})`);
  const [L, fee] = await Promise.all([livro(), taxa()]);
  const r = await calcRota(tipo, valor, L, fee, await rede());
  if (!r) throw new Error("livro de ofertas curto para esse valor");
  if (r.lucro <= 0) throw new Error(`agora daria prejuízo (R$ ${r2(r.lucro)}); o robô não executa no prejuízo`);
  if (r.pct < E.config.minimo) throw new Error(`lucro de ${r.pct.toFixed(3)}% está abaixo do mínimo de ${E.config.minimo}%`);
  if (E.op) throw new Error("já existe uma operação em andamento; espere ela terminar");
  E.op = novaOp(tipo, { ...r, manual: true });
  log(`Execução manual pelo painel: ${tipo === "A" ? "Binance → Carteira" : "Carteira → Binance"} com R$ ${r2(valor)} (lucro previsto R$ ${r2(r.lucro)}, ${r.pct.toFixed(3)}%)`, "op");
  salvar();
  return { ok: true, rota: { valor, lucro: r2(r.lucro), pct: +r.pct.toFixed(3), chegaEm: agora() + (tipo === "A" ? 4 : 10) * 60e3 } };
}

// manda BRLA da carteira do robô para a Picnic (só para esse endereço fixo)
async function sacarPicnic(pedido) {
  if (E.op) throw new Error("tem uma operação em andamento; espere ela terminar para sacar");
  const c = await saldosCarteira();
  if (c.POL < 0.05) throw new Error("a carteira do robô está sem POL para o gás");
  let wei = c.brlaWei;
  if (pedido != null && Number(pedido) > 0) {
    const q = ethers.parseUnits(Number(pedido).toFixed(2), 18);
    if (q < wei) wei = q;
  }
  if (wei < ethers.parseUnits("1", 18)) throw new Error("sem BRLA para sacar na carteira do robô");
  const t = new ethers.Contract(BRLA, ERC20);
  const s = await assinar({ to: BRLA, data: t.interface.encodeFunctionData("transfer", [PICNIC, wei]), value: 0n });
  await transmitir(s.assinada);
  const valor = r2(+ethers.formatUnits(wei, 18));
  log(`Saque: ${valor} BRLA enviados para a sua Picnic. Lá é só fazer o Pix (grátis).`, "op");
  const r = await esperarRecibo(s.hash, 90000);
  if (r && r.status !== 1) throw new Error("a transferência falhou na rede; nada saiu da carteira");
  await atualizarSaldos(); salvar();
  return { ok: true, valor, tx: s.hash, confirmado: !!r };
}

let erradas = 0, bloqueadoAte = 0;
function pinOk(req) {
  if (!ENV.PIN || agora() < bloqueadoAte) return false;
  const h = s => crypto.createHash("sha256").update(String(s)).digest();
  const ok = crypto.timingSafeEqual(h(req.headers["x-pin"] || ""), h(ENV.PIN));
  if (ok) erradas = 0;
  else if (++erradas >= 5) { bloqueadoAte = agora() + 10 * 60e3; erradas = 0; }
  return ok;
}
function publico() {
  const op = E.op ? { ...E.op, rotulo: ROTULO[E.op.etapa] } : null;
  if (op) delete op.txAssinada;
  return {
    ligado: E.ligado, modo: E.modo, config: E.config, carteira: CARTEIRA.address, chaves: !!(ENV.BINANCE_KEY && ENV.BINANCE_SECRET),
    saldos: E.saldos, aval: E.aval, op, radar: E.radar, radarDesde: E.radarDesde, nomes: NOME,
    radarStats: Object.values(E.radarStats).filter(x => x.vezes > 0 || x.melhor > -0.3).sort((x, y) => y.vezes - x.vezes || y.melhor - x.melhor).slice(0, 20), hist: E.hist.slice(0, 60), simulados: E.simulados.slice(0, 40), log: E.log.slice(0, 80),
    atualizado: E.atualizado, agora: agora(),
  };
}
http.createServer(async (req, res) => {
  const enviar = (c, o) => { res.writeHead(c, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
  try {
    const url = new URL(req.url, "http://x");
    // a própria página do painel do robô, servida direto pelo servidor
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/real.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(new URL("./painel.html", import.meta.url)));
    }
    // mesmo formato da ponte do Vercel (/api/real?p=estado|config|ping)
    if (url.pathname === "/api/real") url.pathname = "/" + (url.searchParams.get("p") || "estado");
    if (url.pathname === "/ping") return enviar(200, { ok: true, carteira: CARTEIRA.address, pin: !!ENV.PIN });
    ENV = lerEnv();
    if (!ENV.PIN) return enviar(403, { erro: "PIN ainda não configurado: rode robo-config no servidor" });
    if (!pinOk(req)) return enviar(401, { erro: agora() < bloqueadoAte ? "Muitas tentativas. Espere 10 minutos." : "PIN incorreto" });
    if (req.method === "GET" && url.pathname === "/estado") return enviar(200, publico());
    if (req.method === "GET" && url.pathname === "/painel") return enviar(200, painel());
    if (req.method === "POST" && url.pathname === "/vender") {
      try { return enviar(200, venderAgoraReal()); } catch (e) { return enviar(200, { ok: false, erro: msg(e) }); }
    }
    if (req.method === "POST" && url.pathname === "/sacar") {
      let corpo = "";
      for await (const p of req) { corpo += p; if (corpo.length > 10000) break; }
      const b = JSON.parse(corpo || "{}");
      try { return enviar(200, await sacarPicnic(b.valor)); }
      catch (e) { return enviar(200, { ok: false, erro: msg(e) }); }
    }
    if (req.method === "POST" && url.pathname === "/executar") {
      let corpo = "";
      for await (const p of req) { corpo += p; if (corpo.length > 10000) break; }
      const b = JSON.parse(corpo || "{}");
      try { return enviar(200, await executarManual(String(b.a || ""), String(b.b || ""), b.valor)); }
      catch (e) { return enviar(200, { ok: false, erro: msg(e) }); }
    }
    if (req.method === "POST" && url.pathname === "/config") {
      let corpo = "";
      for await (const p of req) { corpo += p; if (corpo.length > 10000) break; }
      const b = JSON.parse(corpo || "{}");
      const mud = [];
      if (typeof b.ligado === "boolean" && b.ligado !== E.ligado) { E.ligado = b.ligado; mud.push(b.ligado ? "ligado" : "desligado"); }
      if (["observar", "real"].includes(b.modo) && b.modo !== E.modo) { E.modo = b.modo; mud.push(`modo ${b.modo === "real" ? "REAL" : "observar"}`); }
      const num = (v, a, z) => { const x = Number(v); return Number.isFinite(x) && x >= a && x <= z ? x : null; };
      const mx = num(b.max, 20, 100000); if (mx != null && mx !== E.config.max) { E.config.max = mx; mud.push(`valor máximo R$ ${mx}`); }
      const mn = num(b.minimo, 0, 5); if (mn != null && mn !== E.config.minimo) { E.config.minimo = mn; mud.push(`lucro mínimo ${mn}%`); }
    if (typeof b.autoPicnic === "boolean" && b.autoPicnic !== E.config.autoPicnic) { E.config.autoPicnic = b.autoPicnic; mud.push(b.autoPicnic ? "mandar o BRLA para a Picnic no fim de cada operação" : "deixar o BRLA na carteira do robô"); }
      if (mud.length) log("Painel: " + mud.join(", "), "op");
      salvar();
      return enviar(200, publico());
    }
    enviar(404, { erro: "não encontrado" });
  } catch (e) { enviar(500, { erro: msg(e) }); }
}).listen(PORTA, () => console.log("painel do robô na porta", PORTA));

loop();
