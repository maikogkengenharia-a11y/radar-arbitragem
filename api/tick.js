// GET /api/tick -> uma checagem do robô (chamada pelo GitHub Actions e pela página aberta)
import { tick } from "./_motor.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try { res.status(200).json(await tick()); }
  catch (err) { res.status(500).json({ erro: String(err.message || err).slice(0, 200) }); }
}
