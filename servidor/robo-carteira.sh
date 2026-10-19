#!/usr/bin/env bash
# robo-carteira        -> mostra o endereço da carteira do robô
# robo-carteira chave  -> mostra a chave privada (para guardar em papel / importar na MetaMask)
cd /opt/robo/servidor
if [ "${1:-}" = "chave" ]; then
  echo "ATENÇÃO: quem tiver esta chave controla o dinheiro da carteira do robô."
  echo "Anote em papel. Nunca mande para ninguém, nem por print."
  read -rp "Mostrar mesmo assim? (digite SIM): " R < /dev/tty
  [ "$R" = "SIM" ] && node endereco.mjs chave
else
  echo "Endereço da carteira do robô (rede Polygon):"
  node endereco.mjs
fi
