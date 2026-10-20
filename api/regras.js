// POST /api/regras {minimo, max, perfil} -> muda as regras do robô simulado
import { repassar } from "./_sim.js";

export default (req, res) => repassar(req, res, "regras");
