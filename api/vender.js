// POST /api/vender {id} -> vende na hora o USDT da operação em andamento (simulador)
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "vender");
