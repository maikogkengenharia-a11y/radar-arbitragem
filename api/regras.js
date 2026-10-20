// POST /api/regras {minimo, max, perfil}  -> muda as regras do robô simulado
import { alterar } from "./_motor.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, erro: "use POST" });
  const b = req.body || {};
  const num = (v, a, z) => { const x = Number(v); return Number.isFinite(x) && x >= a && x <= z ? x : null; };
  const minimo = num(b.minimo, 0, 5), max = num(b.max, 50, 1000000);
  try {
    const out = await alterar(e => {
      if (minimo != null) e.config.minimo = minimo;
      if (max != null) e.config.max = max;
      if (b.perfil) e.config.perfil = String(b.perfil).slice(0, 20);
      e.log.unshift({ t: Date.now(), txt: `Regras${b.perfil ? ` (perfil ${b.perfil})` : ""}: lucro mínimo ${e.config.minimo}% e até R$ ${e.config.max} por operação.`, tipo: "acc" });
      return { ok: true, config: e.config };
    });
    res.status(200).json(out);
  } catch (e) { res.status(200).json({ ok: false, erro: String(e.message || e).slice(0, 200) }); }
}
