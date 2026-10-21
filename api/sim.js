// Uma função só para todas as chamadas do simulador (o plano grátis da Vercel aceita no máximo 12 funções).
// /api/estado, /api/tick, /api/executar, /api/vender, /api/robo, /api/regras, /api/volta e /api/devolver
// chegam aqui pelo vercel.json como /api/sim?r=<rota> e são repassadas ao servidor do robô.
import { repassar } from "./_sim.js";

const ROTAS = ["estado", "tick", "executar", "vender", "robo", "regras", "volta", "devolver"];

export default (req, res) => {
  const u = new URL(req.url, "http://x");
  const r = u.searchParams.get("r");
  if (!ROTAS.includes(r)) return res.status(404).json({ ok: false, erro: "rota do simulador inválida" });
  u.searchParams.delete("r");
  const q = u.searchParams.toString();
  return repassar(req, res, r + (q ? "?" + q : ""));
};
