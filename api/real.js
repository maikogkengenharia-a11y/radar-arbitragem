// Ponte entre o painel (https) e o robô real no servidor (http, IP fixo).
// GET  /api/real?p=estado   -> estado do robô (precisa do PIN no cabeçalho x-pin)
// POST /api/real?p=config   -> liga/desliga, modo, valor máximo, lucro mínimo
// GET  /api/real?p=ping     -> só verifica se o servidor está no ar
const ROBO = process.env.ROBO_URL || "http://200.141.16.32";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = new URL(req.url, "http://x");
  const p = url.searchParams.get("p") || "estado";
  if (!["estado", "config", "ping", "painel", "executar", "sacar", "vender", "ranking"].includes(p)) return res.status(400).json({ erro: "caminho inválido" });
  try {
    const r = await fetch(`${ROBO}/${p}`, {
      method: req.method === "POST" ? "POST" : "GET",
      headers: { "x-pin": String(req.headers["x-pin"] || ""), "Content-Type": "application/json" },
      body: req.method === "POST" ? JSON.stringify(req.body || {}) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const d = await r.json().catch(() => ({ erro: `resposta inválida do servidor (${r.status})` }));
    res.status(r.status).json(d);
  } catch (e) {
    res.status(502).json({ erro: "O servidor do robô não respondeu. Ele está ligado? (" + String(e?.message || e).slice(0, 80) + ")" });
  }
}
