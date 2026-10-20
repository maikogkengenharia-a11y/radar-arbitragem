// GET /api/tick -> uma checagem do robô simulado (ele já checa sozinho a cada 15 s no servidor)
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "tick");
