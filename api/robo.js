// GET  /api/robo            -> { ligado, alterado }
// POST /api/robo {ligado}   -> liga ou desliga o robô 24h
// O interruptor fica salvo no Vercel Blob (privado), então vale mesmo com a página fechada.
import { put, get } from "@vercel/blob";

const ARQ = "robo/interruptor.json";

async function ler() {
  try {
    const r = await get(ARQ, { access: "private" });
    if (!r || !r.stream) return { ligado: true, alterado: null };
    const txt = await new Response(r.stream).text();
    const d = JSON.parse(txt);
    return { ligado: d.ligado !== false, alterado: d.alterado || null };
  } catch {
    return { ligado: true, alterado: null };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST") {
    let corpo = req.body;
    if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch { corpo = {}; } }
    if (!corpo || typeof corpo.ligado !== "boolean") return res.status(400).json({ erro: "envie { ligado: true ou false }" });
    const novo = { ligado: corpo.ligado, alterado: Date.now() };
    try {
      await put(ARQ, JSON.stringify(novo), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
      return res.status(200).json(novo);
    } catch (e) {
      return res.status(500).json({ erro: "não consegui salvar: " + String(e.message || e).slice(0, 120) });
    }
  }
  return res.status(200).json(await ler());
}
