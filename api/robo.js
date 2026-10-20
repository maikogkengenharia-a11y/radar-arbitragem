// GET/POST /api/robo {ligado} -> liga ou desliga o robô simulado
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "robo");
