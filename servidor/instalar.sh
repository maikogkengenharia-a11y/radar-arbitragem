#!/usr/bin/env bash
# Instala o robô no servidor (Ubuntu). Uso:
#   bash <(curl -fsSL https://raw.githubusercontent.com/maikogkengenharia-a11y/radar-arbitragem/main/servidor/instalar.sh)
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "== 1/5 Instalando programas básicos =="
apt-get update -qq
apt-get install -y -qq git curl ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
timedatectl set-ntp true >/dev/null 2>&1 || true
echo "== 2/5 Baixando o robô =="
if [ -d /opt/robo/.git ]; then git -C /opt/robo fetch -q origin main && git -C /opt/robo reset -q --hard origin/main
else git clone -q https://github.com/maikogkengenharia-a11y/radar-arbitragem.git /opt/robo; fi
cd /opt/robo/servidor
npm install --omit=dev --no-audit --no-fund --loglevel=error
echo "== 3/5 Carteira do robô =="
mkdir -p /etc/robo /var/lib/robo; chmod 700 /etc/robo
if [ ! -s /etc/robo/carteira.key ]; then
  ( umask 077; node nova-carteira.mjs > /etc/robo/carteira.key )
  echo "Carteira nova criada."
else echo "Carteira já existia (mantida)."; fi
touch /etc/robo/config.env; chmod 600 /etc/robo/config.env
install -m 755 robo-config.sh /usr/local/bin/robo-config
install -m 755 robo-carteira.sh /usr/local/bin/robo-carteira
echo "== 4/5 Deixando o robô ligado 24h =="
cp robo.service robo-atualizar.service robo-atualizar.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable -q --now robo robo-atualizar.timer
systemctl restart robo
echo "== 5/5 Pronto =="
echo
echo "IP deste servidor: $(curl -fsS https://api.ipify.org || echo '?')"
echo "Endereço da carteira do robô (rede Polygon):"
echo "    $(node endereco.mjs)"
echo
echo "Próximo passo: mande um print desta tela."
