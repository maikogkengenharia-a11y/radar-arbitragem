// GET /api/estado -> saldos, histórico, atividade e operação em andamento do simulador
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "estado");
