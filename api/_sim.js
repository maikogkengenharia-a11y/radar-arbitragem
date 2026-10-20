// Repassa as chamadas do simulador para o servidor do robô (Hostinger), onde o simulador roda 24h.
const ROBO = process.env.ROBO_URL || "http://200.141.16.32";

export async function repassar(req, res, rota) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const r = await fetch(`${ROBO}/sim/${rota}`, {
      method: req.method === "POST" ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: req.method === "POST" ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {})) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({ ok: false, erro: `resposta inválida do servidor (${r.status})` }));
    res.status(r.status).json(d);
  } catch (e) {
    res.status(502).json({ ok: false, erro: "o servidor do simulador não respondeu: " + String(e?.message || e).slice(0, 80) });
  }
}
