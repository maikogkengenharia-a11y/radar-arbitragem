// GET /api/estado -> saldos, histórico, atividade, operação em andamento e liga/desliga do robô
import { lerEstado } from "./_motor.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { e } = await lerEstado();
    res.status(200).json(e);
  } catch (err) {
    res.status(500).json({ erro: "não consegui ler o estado: " + String(err.message || err).slice(0, 150) });
  }
}
