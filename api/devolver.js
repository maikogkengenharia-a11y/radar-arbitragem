// POST /api/devolver {c, via} -> manda o dinheiro da corretora de volta para a Binance (simulador)
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "devolver");
