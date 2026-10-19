#!/usr/bin/env bash
# Puxa a versão nova do GitHub; se mudou algo, reinstala e reinicia o robô.
set -e
cd /opt/robo
ANTES=$(git rev-parse HEAD)
git fetch -q origin main
git reset -q --hard origin/main
DEPOIS=$(git rev-parse HEAD)
if [ "$ANTES" != "$DEPOIS" ]; then
  cd servidor
  npm install --omit=dev --no-audit --no-fund --loglevel=error
  install -m 755 robo-config.sh /usr/local/bin/robo-config
  install -m 755 robo-carteira.sh /usr/local/bin/robo-carteira
  systemctl restart robo
  echo "robô atualizado para $DEPOIS"
fi
