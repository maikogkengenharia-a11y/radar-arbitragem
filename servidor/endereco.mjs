// Mostra o endereço público da carteira do robô (e a chave privada, se pedir "chave").
import fs from "node:fs";
import { Wallet } from "ethers";
const w = new Wallet(fs.readFileSync("/etc/robo/carteira.key", "utf8").trim());
if (process.argv[2] === "chave") console.log(w.privateKey);
else console.log(w.address);
