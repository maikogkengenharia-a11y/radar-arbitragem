// Gera uma carteira nova só para o robô e imprime a chave privada (o instalador grava em /etc/robo/carteira.key).
import { Wallet } from "ethers";
console.log(Wallet.createRandom().privateKey);
