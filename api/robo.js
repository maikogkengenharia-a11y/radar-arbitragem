// GET  /api/robo           -> { ligado }
// POST /api/robo {ligado}  -> liga ou desliga o robô (fica salvo no servidor)
import { lerEstado, alterar } from "./_motor.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "POST") {
      let c = req.body;
      if (typeof c === "string") { try { c = JSON.parse(c); } catch { c = {}; } }
      if (!c || typeof c.ligado !== "boolean") return res.status(400).json({ erro: "envie { ligado: true ou false }" });
      const out = await alterar(e => {
        e.ligado = c.ligado;
        e.log = e.log || [];
        e.log.unshift({ t: Date.now(), txt: c.ligado ? "Robô ligado pelo painel." : "Robô desligado pelo painel: não faz novas compras (se houver USDT a caminho, termina a venda sem prejuízo).", tipo: c.ligado ? "good" : "warn" });
        return { ligado: e.ligado, alterado: Date.now() };
      });
      return res.status(200).json(out);
    }
    const { e } = await lerEstado();
    res.status(200).json({ ligado: e.ligado !== false });
  } catch (err) { res.status(500).json({ erro: String(err.message || err).slice(0, 200) }); }
}
