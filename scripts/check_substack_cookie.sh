#!/usr/bin/env bash
# Contrôle quotidien du cookie Substack. Silencieux tant que tout va bien ;
# alerte Telegram immédiate le jour où le cookie expire ou devient invalide.
set -euo pipefail

export PATH="/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin"
cd /home/agent/ghitastar-agent

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${SUBSTACK_PUBLICATION_URL:-}" ] || [ -z "${SUBSTACK_COOKIE:-}" ]; then
  echo "[cookie-check] $(date -u '+%F %T') UTC : Substack non configuré, rien à vérifier."
  exit 0
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
  -H "Cookie: ${SUBSTACK_COOKIE}" \
  "${SUBSTACK_PUBLICATION_URL}/api/v1/publication/users" || echo "000")

if [ "$code" = "200" ]; then
  echo "[cookie-check] $(date -u '+%F %T') UTC : cookie valide (200)."
  exit 0
fi

# 000 = réseau injoignable : on ne crie pas au loup pour une panne transitoire.
if [ "$code" = "000" ]; then
  echo "[cookie-check] $(date -u '+%F %T') UTC : Substack injoignable, on réessaiera demain."
  exit 0
fi

echo "[cookie-check] $(date -u '+%F %T') UTC : cookie invalide (HTTP $code), alerte envoyée."
node scripts/notify_telegram.js --chat 6679204446 --text "⚠️ Le cookie Substack ne fonctionne plus (HTTP $code au contrôle quotidien).

Conséquence : le prochain heartbeat ne pourra pas créer le brouillon dans Substack (tu recevras l'article ici en fichier, rien ne sera perdu).

Pour le renouveler : Chrome connecté à wtfaitoday.substack.com → F12 → Application → Cookies → substack.sid, puis remplace la ligne SUBSTACK_COOKIE dans ~/ghitastar-agent/.env sur le VPS."
