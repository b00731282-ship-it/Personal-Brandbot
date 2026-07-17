'use strict';
// Socle de la fleet Ghitastar : lance un sous-agent Claude en headless et
// récupère sa sortie de façon déterministe. Zéro dépendance npm.
//
// Principe : chaque sous-agent est une invocation `claude -p` isolée, avec
// une responsabilité unique. On ne parse jamais le texte libre du modèle ;
// on lui demande d'ÉCRIRE son résultat dans un fichier de sortie que
// l'orchestrateur relit. C'est le contrat qui rend la chaîne débuggable.
//
// --strict-mcp-config est non négociable : sans lui, un run headless
// recharge le plugin Telegram et fait tomber la session de canal (409).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

// Outils autorisés par défaut : lecture, écriture, web, et les scripts node
// déterministes. Pas d'outil MCP (indispo/instable en headless).
const DEFAULT_TOOLS = 'Read,Glob,Grep,Write,Edit,WebFetch,WebSearch,Bash(node:*)';

function log(runDir, agent, msg) {
  const line = `[${agent}] ${new Date().toISOString()} ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(path.join(runDir, 'fleet.log'), line); } catch { /* best effort */ }
}

// Lance un sous-agent. Retourne le texte de sortie brut du modèle.
// promptFile : fichier .md décrivant le rôle. input : objet passé à l'agent.
// outfile : chemin ABSOLU où l'agent doit écrire son livrable (l'orchestrateur
// le lit ensuite). timeoutMs : garde-fou.
function runAgent({ runDir, agent, promptFile, input = {}, outfile, tools, timeoutMs = 600000 }) {
  const role = fs.readFileSync(path.join(__dirname, 'agents', promptFile), 'utf8');

  const prompt = [
    role,
    '',
    '## Contexte d\'entrée (JSON)',
    '```json',
    JSON.stringify(input, null, 2),
    '```',
    '',
    outfile
      ? `## Sortie\nÉcris ton livrable dans le fichier : \`${outfile}\`\nN'écris nulle part ailleurs. Quand c'est fait, réponds seulement OK.`
      : '',
  ].join('\n');

  log(runDir, agent, 'démarrage');
  const res = spawnSync('claude', [
    '-p', prompt,
    '--allowedTools', tools || DEFAULT_TOOLS,
    '--strict-mcp-config',
  ], { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });

  if (res.error) {
    log(runDir, agent, `ÉCHEC lancement : ${res.error.message}`);
    throw new Error(`Sous-agent ${agent} : ${res.error.message}`);
  }
  const out = (res.stdout || '').trim();
  log(runDir, agent, `terminé (${out.length} car. de sortie)`);
  return out;
}

// Comme runAgent, mais renvoie l'objet JSON écrit dans outfile.
function runAgentJson(opts) {
  runAgent(opts);
  const raw = fs.readFileSync(opts.outfile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Sous-agent ${opts.agent} : sortie JSON invalide dans ${opts.outfile} (${e.message})`);
  }
}

module.exports = { REPO, DEFAULT_TOOLS, log, runAgent, runAgentJson };
