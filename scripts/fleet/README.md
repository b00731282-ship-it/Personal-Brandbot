# Fleet Ghitastar

Architecture multi-agents. Un **orchestrateur** (« famous investor ») pilote deux boucles : **inbound** (contenu) et **outbound** (relations).

```
                    ORCHESTRATEUR (famous investor)
                    /                              \
        INBOUND (contenu)                   OUTBOUND (relations)
        headless-safe, cron vendredi        session authentifiée, à la demande
        │                                    │
        ├─ veille        → signals.json      ├─ sourcing  (Specter+Attio → candidates.json)
        ├─ judge         → thèse retenue      └─ outreach  (rédige des brouillons, N'ENVOIE JAMAIS)
        ├─ article       → draft .md
        ├─ verify (adv.) → verdict + révision
        ├─ linkedin      → posts .md
        └─ livraison     → Substack + Telegram
```

## Deux modèles d'exécution — pourquoi

Un `claude -p` headless **n'hérite pas** des connecteurs claude.ai (vérifié : renvoie `NONE`). D'où deux régimes :

- **Inbound** : chaque sous-agent est un `claude -p --strict-mcp-config` isolé, sans MCP. Déterministe, débuggable, tourne dans le cron du vendredi. Orchestré par `orchestrator.js`.
- **Outbound** : a besoin de Specter / Attio / Gmail, qui ne vivent que dans une **session authentifiée**. Ne se lance donc jamais en headless. La boucle s'exécute dans une session (via l'outil Agent ou directement), en suivant `agents/sourcing.md` puis `agents/outreach.md`. État persistant dans `data/outbound/candidates.json`.

`--strict-mcp-config` est obligatoire sur tout `claude -p` de ce VPS : sinon un second poller Telegram fait tomber la session de canal (409).

## Inbound — usage

```bash
node scripts/fleet/orchestrator.js               # cycle complet + livraison
node scripts/fleet/orchestrator.js --no-deliver  # tout sauf Substack/Telegram (répétition)
node scripts/fleet/orchestrator.js --no-judge    # sans le panel de juges
node scripts/fleet/orchestrator.js --only veille  # une étape (debug)
```

Chaque run est tracé dans `logs/fleet/<horodatage>/` (fleet.log + livrables intermédiaires).

## Outbound — usage (session authentifiée uniquement)

Dans une session avec les connecteurs, dérouler :
1. **Sourcing** — suivre `agents/sourcing.md` avec un `brief` (ex. « family offices européens actifs en IA »). Écrit `data/outbound/candidates.json`. N'écrit dans le CRM Attio que sur `commit_to_crm: true`.
2. **Outreach** — suivre `agents/outreach.md` sur les candidats `status: new`. Écrit des brouillons dans `drafts/outreach/`. **N'envoie jamais** : au plus un brouillon Gmail. L'humaine valide et envoie.

## Garanties (par conception)

- L'agent ne **publie** jamais (contenu) et n'**envoie** jamais (outreach). Toujours des brouillons.
- Aucun **fait inventé** : la vérification adversariale bloque un article dont un fait n'est pas sourçable.
- Les **secrets** restent dans l'environnement du VPS, jamais dans le code ni le repo.
