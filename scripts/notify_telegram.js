#!/usr/bin/env node
// Notification Telegram directe via l'API Bot — zéro dépendance.
//
// Pourquoi pas l'outil MCP du plugin ? En mode headless (heartbeat cron),
// le plugin peut entrer en conflit de polling (409) avec la session de canal
// interactive. L'envoi direct par HTTPS ne polle pas : aucun conflit possible.
//
// Usage :
//   node scripts/notify_telegram.js --chat 123456 --text "message"
//   node scripts/notify_telegram.js --chat 123456 --text "message" --file drafts/article.md
//
// Le token est lu depuis TELEGRAM_BOT_TOKEN, ou depuis le .env du canal
// (~/.claude/channels/telegram/.env) s'il n'est pas dans l'environnement.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    }
  }
  return args;
}

function emit(obj) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(obj.ok ? 0 : 1);
}

function readToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const envFile = path.join(os.homedir(), '.claude', 'channels', 'telegram', '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

(async () => {
  const args = parseArgs();

  if (args.help) {
    return emit({
      ok: true,
      tool: 'notify_telegram',
      usage: {
        '--chat id': 'Chat Telegram destinataire (requis).',
        '--text t': 'Texte du message (requis). Découpé automatiquement si > 4096 caractères.',
        '--file f': 'Fichier à joindre en document (optionnel).',
      },
    });
  }

  const token = readToken();
  if (!token) {
    return emit({ ok: false, tool: 'notify_telegram', error: 'missing_env', missing: ['TELEGRAM_BOT_TOKEN'] });
  }

  const chat = String(args.chat || '');
  const text = String(args.text || '');
  if (!chat) return emit({ ok: false, tool: 'notify_telegram', error: '--chat est requis.' });
  if (!text) return emit({ ok: false, tool: 'notify_telegram', error: '--text est requis.' });

  const api = (method) => `https://api.telegram.org/bot${token}/${method}`;
  const sent = [];

  // Texte, découpé par blocs de 4096 max (limite Telegram), de préférence sur une ligne vide.
  let rest = text;
  while (rest.length > 0) {
    let chunk = rest;
    if (chunk.length > 4096) {
      let cut = rest.lastIndexOf('\n\n', 4096);
      if (cut < 1000) cut = rest.lastIndexOf('\n', 4096);
      if (cut < 1000) cut = 4096;
      chunk = rest.slice(0, cut);
    }
    rest = rest.slice(chunk.length).replace(/^\s+/, '');
    const res = await fetch(api('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: chunk }),
    });
    const data = await res.json();
    if (!data.ok) return emit({ ok: false, tool: 'notify_telegram', error: `Telegram : ${data.description || res.status}`, sent });
    sent.push(data.result.message_id);
  }

  // Pièce jointe éventuelle.
  if (args.file) {
    const file = String(args.file);
    if (!fs.existsSync(file)) return emit({ ok: false, tool: 'notify_telegram', error: `Fichier introuvable : ${file}`, sent });
    const form = new FormData();
    form.append('chat_id', chat);
    form.append('document', new Blob([fs.readFileSync(file)]), path.basename(file));
    const res = await fetch(api('sendDocument'), { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) return emit({ ok: false, tool: 'notify_telegram', error: `Telegram (document) : ${data.description || res.status}`, sent });
    sent.push(data.result.message_id);
  }

  emit({ ok: true, tool: 'notify_telegram', chat, messages: sent });
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, tool: 'notify_telegram', error: e.message }, null, 2));
  process.exit(1);
});
