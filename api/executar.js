// POST /api/executar { a, b, valor } -> executa a rota agora (manual), usando o saldo do robô 24h
import { executarManual } from "./_motor.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });
  let c = req.body;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { c = {}; } }
  try {
    const r = await executarManual(c?.a, c?.b, c?.valor);
    res.status(r.ok ? 200 : 409).json(r);
  } catch (err) { res.status(500).json({ ok: false, erro: String(err.message || err).slice(0, 200) }); }
}
