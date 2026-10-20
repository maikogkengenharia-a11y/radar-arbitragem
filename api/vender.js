// POST /api/vender {id}  -> vende na hora o USDT da operação em andamento (simulador), mesmo com prejuízo
import { venderAgora } from "./_motor.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, erro: "use POST" });
  try { res.status(200).json(await venderAgora(req.body?.id)); }
  catch (e) { res.status(200).json({ ok: false, erro: String(e.message || e).slice(0, 200) }); }
}
