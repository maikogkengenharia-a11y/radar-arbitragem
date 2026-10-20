// POST /api/executar {a, b, valor} -> executa a rota agora (manual) no simulador
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "executar");
