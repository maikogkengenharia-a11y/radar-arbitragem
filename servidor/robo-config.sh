#!/usr/bin/env bash
# Grava as chaves da Binance e o PIN do painel. Ficam só neste servidor (/etc/robo/config.env).
set -euo pipefail
F=/etc/robo/config.env
touch "$F"; chmod 600 "$F"
atual() { grep -E "^$1=" "$F" | head -1 | cut -d= -f2- || true; }
K=$(atual BINANCE_KEY); S=$(atual BINANCE_SECRET); P=$(atual PIN)
echo "=== Configuração do robô (Enter = manter o valor atual) ==="
read -rp "API Key da Binance${K:+ (já configurada)}: " NK < /dev/tty
read -rsp "Secret Key da Binance (não aparece ao colar)${S:+ (já configurada)}: " NS < /dev/tty; echo
read -rsp "PIN do painel, mínimo 6 caracteres${P:+ (já configurado)}: " NP < /dev/tty; echo
K=${NK:-$K}; S=${NS:-$S}; P=${NP:-$P}
if [ -n "$P" ] && [ ${#P} -lt 6 ]; then echo "PIN muito curto (mínimo 6). Nada foi salvo."; exit 1; fi
umask 077
printf 'BINANCE_KEY=%s\nBINANCE_SECRET=%s\nPIN=%s\n' "$K" "$S" "$P" > "$F"
systemctl restart robo
echo "Salvo. Robô reiniciado."
