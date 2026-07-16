#!/usr/bin/env bash
# Watchdog du connecteur Telegram (toutes les 2 min via cron).
#
# La reconnexion du connecteur MCP ne peut se faire que depuis la session
# Claude elle-même (/mcp). Ce watchdog fait donc le maximum possible de
# l'extérieur : détecter la chute en 2 minutes et alerter sur Telegram
# (par l'API directe, qui ne dépend pas du connecteur), avec la consigne.
set -euo pipefail

export PATH="/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin"
STATE=/home/agent/ghitastar-agent/logs/telegram-watchdog.state
CHAT=6679204446
cd /home/agent/ghitastar-agent

# Pas de session canal ouverte : rien à surveiller (fermée volontairement).
if ! pgrep -f 'claude .*--channels plugin:telegram' > /dev/null; then
  echo "up" > "$STATE"
  exit 0
fi

# Le connecteur est le processus du plugin telegram enfant de la session.
if pgrep -f 'plugins/cache/claude-plugins-official/telegram' > /dev/null; then
  # Connecteur vivant. S'il était marqué tombé, signaler le retour.
  if [ "$(cat "$STATE" 2>/dev/null || echo up)" = "down" ]; then
    node scripts/notify_telegram.js --chat "$CHAT" \
      --text "✅ Le connecteur Telegram est reconnecté. Tout est revenu à la normale." || true
  fi
  echo "up" > "$STATE"
  exit 0
fi

# Session vivante mais connecteur mort : alerter une seule fois par chute.
if [ "$(cat "$STATE" 2>/dev/null || echo up)" != "down" ]; then
  echo "down" > "$STATE"
  echo "[watchdog] $(date -u '+%F %T') UTC : connecteur tombé, alerte envoyée."
  node scripts/notify_telegram.js --chat "$CHAT" \
    --text "⚠️ Le connecteur Telegram de la session Claude vient de tomber : tes messages ici ne remontent plus vers l'agent (l'envoi, lui, fonctionne encore, preuve avec ce message).

Pour le relancer : dans le terminal de la session, taper /mcp (reconnexion en un choix de menu). Les messages envoyés entre-temps seront livrés à la reconnexion, rien n'est perdu." || true
fi
