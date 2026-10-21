// GET /api/volta?c=corretora -> quanto chega na Binance por Pix e por USDT (simulador)
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "volta?c=" + encodeURIComponent(new URL(req.url, "http://x").searchParams.get("c") || ""));
