#!/usr/bin/env node
'use strict';
// Orchestrateur de la fleet Ghitastar — l'identité « famous investor ».
// Enchaîne les sous-agents de contenu de façon déterministe :
//
//   veille → article → vérification → (révision si besoin) → linkedin → livraison
//
// Chaque étape est un sous-agent Claude isolé (voir scripts/fleet/agents/*.md).
// Les étapes de livraison (Substack, Telegram) restent des scripts
// déterministes existants. Ce qui doit être fiable est du code, pas du
// raisonnement.
//
// Usage :
//   node scripts/fleet/orchestrator.js               # cycle complet
//   node scripts/fleet/orchestrator.js --no-deliver  # tout sauf Substack/Telegram
//   node scripts/fleet/orchestrator.js --only veille  # une seule étape (debug)
//   node scripts/fleet/orchestrator.js --chat 123     # chat Telegram (défaut 6679204446)

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { REPO, log, runAgent, runAgentJson } = require('./lib');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const CHAT = String(arg('chat', '6679204446'));
const ONLY = arg('only', null);
const NO_DELIVER = process.argv.includes('--no-deliver');
const NO_JUDGE = process.argv.includes('--no-judge'); // panel de juges actif par défaut

// Dossier de run horodaté hors git (le nom vient du système de fichiers, pas
// de Date.now(), pour rester reproductible si relancé).
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = path.join(REPO, 'logs', 'fleet', stamp);
fs.mkdirSync(runDir, { recursive: true });

const p = (f) => path.join(runDir, f);
const draftsDir = path.join(REPO, 'drafts');

function node(scriptArgs, opts = {}) {
  return spawnSync('node', scriptArgs, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function notify(text, file) {
  const args = ['scripts/notify_telegram.js', '--chat', CHAT, '--text', text];
  if (file) args.push('--file', file);
  const r = node(args);
  log(runDir, 'orchestrator', `telegram: ${(r.stdout || r.stderr || '').trim().slice(0, 120)}`);
}

(async () => {
  log(runDir, 'orchestrator', `run ${stamp} démarré (chat ${CHAT})`);

  // 1. VEILLE ----------------------------------------------------------------
  const signalsFile = p('signals.json');
  if (!ONLY || ONLY === 'veille') {
    runAgentJson({ runDir, agent: 'veille', promptFile: 'veille.md', input: {}, outfile: signalsFile });
  }
  if (ONLY === 'veille') { log(runDir, 'orchestrator', 'stop après veille'); return; }
  const signals = JSON.parse(fs.readFileSync(signalsFile, 'utf8'));
  log(runDir, 'orchestrator', `veille : ${signals.signals.length} signaux`);

  // 2. PANEL DE JUGES — choisit l'angle/thèse le plus différenciant ----------
  let chosen = null;
  if (!NO_JUDGE) {
    const judgeFile = p('judge.json');
    const j = runAgentJson({ runDir, agent: 'judge', promptFile: 'judge.md', input: { signals }, outfile: judgeFile });
    chosen = j.chosen || null;
    log(runDir, 'orchestrator', `juges : thèse retenue « ${(chosen && chosen.thesis || '').slice(0, 70)}… »`);
  }

  // 3. ARTICLE ---------------------------------------------------------------
  const slug = `${signals.week || stamp.slice(0, 10)}-fleet`;
  const articleFile = path.join(draftsDir, `${slug}.md`);
  runAgent({ runDir, agent: 'article', promptFile: 'article.md', input: { signals, chosen_thesis: chosen, outfile: articleFile }, outfile: articleFile });

  // 3. VÉRIFICATION ADVERSARIALE + révision éventuelle ------------------------
  const verdictFile = p('verdict.json');
  let verdict = runAgentJson({
    runDir, agent: 'verify', promptFile: 'verify.md',
    input: { article_path: articleFile, signals }, outfile: verdictFile,
  });
  log(runDir, 'orchestrator', `vérif : ${verdict.verdict}, ${(verdict.must_fix || []).length} correction(s)`);

  if (verdict.verdict !== 'LIVRABLE' && (verdict.must_fix || []).length) {
    // Une passe de révision : l'agent article corrige exactement ce que la
    // vérification a listé, puis on re-vérifie une fois.
    runAgent({
      runDir, agent: 'article-revise', promptFile: 'article.md',
      input: { signals, outfile: articleFile, revise_existing: articleFile, must_fix: verdict.must_fix },
      outfile: articleFile,
    });
    verdict = runAgentJson({
      runDir, agent: 'verify-2', promptFile: 'verify.md',
      input: { article_path: articleFile, signals }, outfile: verdictFile,
    });
    log(runDir, 'orchestrator', `vérif (2) : ${verdict.verdict}`);
  }

  if (verdict.verdict === 'BLOQUE') {
    notify(`⚠️ Fleet Ghitastar : l'article de la semaine est BLOQUÉ au contrôle factuel (un fait non sourçable). Il n'a pas été mis en brouillon. Détail des points à corriger :\n\n- ${(verdict.must_fix || []).join('\n- ')}\n\nL'article est joint pour relecture manuelle.`, articleFile);
    log(runDir, 'orchestrator', 'BLOQUE : arrêt avant livraison');
    return;
  }

  // 4. LINKEDIN --------------------------------------------------------------
  const linkedinFile = path.join(draftsDir, `${slug}-linkedin.md`);
  runAgent({ runDir, agent: 'linkedin', promptFile: 'linkedin.md', input: { signals, article_path: articleFile, outfile: linkedinFile }, outfile: linkedinFile });

  if (NO_DELIVER) { log(runDir, 'orchestrator', '--no-deliver : stop avant Substack/Telegram'); return; }

  // 5. LIVRAISON (déterministe) ----------------------------------------------
  const draft = node(['scripts/create_substack_draft.js', '--file', articleFile]);
  let editUrl = null;
  try { editUrl = JSON.parse(draft.stdout).edit_url; } catch { /* garde null */ }
  log(runDir, 'orchestrator', `substack : ${editUrl || 'échec (voir sortie)'}`);

  // Extraire titre / thèse pour la notif.
  const body = fs.readFileSync(articleFile, 'utf8');
  const title = (body.match(/^title:\s*(.+)$/m) || [])[1] || slug;

  const msg = [
    `📰 Fleet Ghitastar — article de la semaine prêt (verdict factuel : ${verdict.verdict})`,
    ``,
    `« ${title} »`,
    ``,
    editUrl ? `Brouillon Substack : ${editUrl}` : `⚠️ Création Substack échouée (cookie expiré ?). Article joint, rien n'est perdu.`,
    `Posts LinkedIn joints séparément.`,
    ``,
    `Rien n'est publié : tu relis et tu publies.`,
  ].join('\n');
  notify(msg, articleFile);
  notify(`Posts LinkedIn de la semaine (prêts à copier) :`, linkedinFile);

  log(runDir, 'orchestrator', 'run terminé');
})().catch((e) => {
  log(runDir, 'orchestrator', `ERREUR : ${e.message}`);
  try { notify(`⚠️ Fleet Ghitastar : le cycle a échoué (${e.message}). Voir logs/fleet/${stamp}/fleet.log sur le VPS.`); } catch { /* best effort */ }
  process.exit(1);
});
