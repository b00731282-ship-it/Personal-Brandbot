#!/usr/bin/env bash
# Sourcing du matin — durable (cron système), headless via clients API à clé.
# 10 leads par deal, chaque matin 8h Paris, MAIS seulement si la liste cible
# a été vidée d'au moins 50% depuis le dernier run (backpressure).
set -euo pipefail

export PATH="/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin"
cd /home/agent/ghitastar-agent

CHAT=6679204446
LIST=specter_db_de_2
STATE=data/outbound/list_baseline.json

if [ -f .env ]; then set -a; . ./.env; set +a; fi

# Garde-fou fuseau : ne tourner qu'à 8h heure de Paris (cron lance à 6h et 7h UTC).
if [ "${1:-}" != "--force" ] && [ "$(TZ=Europe/Paris date +%H)" != "08" ]; then
  echo "[morning] $(date -u '+%F %T') UTC : pas 8h Paris, skip."; exit 0
fi

count_list() {
  node scripts/attio.js list-entries "$LIST" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log((JSON.parse(d).data||[]).length)}catch{console.log(-1)}})"
}

CUR=$(count_list)
BASE=$(node -e "try{console.log(require('./$STATE').count||0)}catch{console.log(0)}")

echo "[morning] $(date -u '+%F %T') UTC : liste=$CUR, baseline=$BASE"

if [ "$CUR" -lt 0 ]; then
  echo "[morning] lecture Attio impossible (clé ?), abandon."; exit 1
fi

# Gate : run seulement si vidée >=50% (current <= baseline/2). Premier run (base 0) : run.
if [ "$BASE" -gt 0 ] && [ "$CUR" -gt "$((BASE/2))" ]; then
  node scripts/notify_telegram.js --chat "$CHAT" --text "☀️ Sourcing du matin sauté : la liste Specter DB - Day n'a pas été vidée d'au moins 50% depuis le dernier run ($CUR sur $BASE contacts encore présents). Traite les leads existants, je reprends dès que tu es sous $((BASE/2))." >/dev/null 2>&1 || true
  echo "[morning] gate non atteint ($CUR/$BASE), skip."; exit 0
fi

echo "[morning] gate OK, lancement du sourcing (10/deal)."
claude -p "$(cat scripts/morning_sourcing_prompt.md)" \
  --allowedTools "Read,Glob,Grep,Write,Edit,WebFetch,WebSearch,Bash(node:*)" \
  --strict-mcp-config 2>&1

# Nouveau baseline = état de la liste après ajout.
NEW=$(count_list)
[ "$NEW" -lt 0 ] && NEW=0
node -e "const fs=require('fs');fs.writeFileSync('$STATE',JSON.stringify({count:$NEW,updated:'$(date -u '+%F')'},null,2))"
echo "[morning] terminé, nouveau baseline=$NEW."
