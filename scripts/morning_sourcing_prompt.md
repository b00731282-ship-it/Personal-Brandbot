# Morning sourcing — headless durable (10 leads / deal)

Tu es lancé automatiquement, sans connecteurs claude.ai. **Utilise les clients API à clé** : `node scripts/specter.js` et `node scripts/attio.js`. Personne ne lit ce terminal. Sourcing uniquement : tu ne contactes personne.

## Étapes

1. **Deals actifs** : `node scripts/attio.js deals`. Chaque entrée pointe une company (le deal). Ne garde que les deals qui sont aussi une **option valide du champ `deal_shared`** de la liste cible : **NEURA** (robotics/IA), **Peec AI** (AI search / martech / SaaS), **LAP Coffee** (consumer / F&B / coffee retail). Si tu doutes du secteur d'un deal, `node scripts/specter.js company <domain>`.

2. **Sourcing** : pour CHAQUE deal matchable, trouve **10 nouveaux investisseurs** pertinents : `node scripts/specter.js search "<requête ciblée sur le secteur du deal>" people`. Adapte la requête au secteur (ex. Peec AI → « angel and seed investors in AI, martech and B2B SaaS in Europe » ; LAP Coffee → « consumer, F&B and retail brand investors in Europe »).

3. **Déduplication** : `node scripts/attio.js list-entries specter_db_de_2` (contacts déjà présents) + lis `data/outbound/candidates.json`. N'ajoute jamais un contact déjà là (par nom ou LinkedIn).

4. **Enrichissement** : pour chaque nouveau candidat, `node scripts/specter.js person <linkedin_url>` → prénom, nom, pays, société, # investments (compte les positions d'investisseur), # exits. N'invente jamais un chiffre : s'il n'est pas dans Specter, laisse vide.

5. **Écriture Attio** :
   - `node scripts/attio.js create-person '<json values>'` avec `name` = `[{"first_name":"","last_name":"","full_name":""}]`, `linkedin`, `job_title` (avec la société), `description` (focus + « Sourced via Specter for <deal> »). Récupère le `record_id` renvoyé.
   - `node scripts/attio.js add-to-list specter_db_de_2 <record_id> '<json entry_values>'` avec `investments`, `exits`, `deal_shared` = `["<deal matché>"]`, et `country` **seulement si** c'est une option valide (Germany, United States, United Kingdom, Spain, Switzerland, Portugal, Poland, Singapore, Austria, United Arab Emirates, Saudi Arabia, Israel) — sinon omets-le.

6. **État** : mets à jour `data/outbound/candidates.json` (ajoute les nouveaux).

7. **Notification** : `node scripts/notify_telegram.js --chat 6679204446 --text "<récap par deal : nom, société, pays, # invest, deal>"`. Précise le total ajouté et rappelle que les brouillons d'outreach ne sont pas générés en mode headless (Gmail nécessite la session).

Continue jusqu'à 10 nouveaux par deal matchable, ou jusqu'à épuisement des résultats Specter.
