# JURIA — Audit du comité d'investissement

**Décision simulée : investissement de 20 M€ — GO / NO-GO**

Comité : ancien Partner M&A (Clifford Chance) · General Counsel groupe coté · Directeur Juridique banque · Associé cabinet d'affaires · Head of Product (Notion) · ex-Product Lead (Doctrine) · ex-ingénieur principal (Harvey AI) · UX Designer (Linear) · CTO SaaS B2B

Rapport rédigé le 9 juillet 2026, sur la base d'une revue intégrale du repository, des flux déployés et de l'état de la base de données.

---

## VERDICT GLOBAL AVANT DÉTAIL

**NO-GO à 20 M€ dans l'état actuel. GO possible sur un plan à 18 mois, à condition d'accepter trois décisions structurantes.**

Juria aujourd'hui est un **prototype bien exécuté d'assistant juridique généraliste**, pas un logiciel pour directions juridiques Corporate Finance. L'écart n'est pas un écart de finition : c'est un écart de **nature**. Le produit est organisé autour du *document isolé* et du *chat* ; le métier visé est organisé autour du *dossier* (deal, contentieux, financement), des *échéances* et de la *responsabilité personnelle du juriste*. Tant que cette inversion n'est pas faite, aucune quantité de fonctionnalités IA ne rendra le produit indispensable à 8h30 du matin.

Les trois décisions structurantes :

1. **Pivot "matter-centric"** : le dossier devient l'objet racine de tout le produit (documents, échéances, tâches, parties, IA). C'est ce que Harvey, iManage et Litera ont en commun malgré leurs différences.
2. **Réécriture du front** : 15 pages HTML monolithiques avec JavaScript inline dupliqué ne portent pas un produit à 1 000 €/mois. La logique métier est récupérable ; l'enveloppe ne l'est pas.
3. **Course au corpus marocain** : sans Bulletin Officiel versionné, jurisprudence de la Cour de cassation et réglementations sectorielles (AMMC, BAM, Office des Changes), Juria reste un wrapper GPT que n'importe qui peut répliquer en trois mois. Le corpus est la seule barrière défensive disponible sur ce marché.

Ce qui joue **pour** l'investissement : un marché marocain (puis OHADA) quasi vierge, aucun des douze concurrents de référence n'y est localisé, une équipe qui livre vite (l'historique git le prouve), et des fondations backend (multi-tenant, quotas, RLS) plus sérieuses que la moyenne des prototypes.

---

# 1. AUDIT PRODUIT

## Note globale : 3/10 *(en tant que produit pour la cible annoncée)* — 6,5/10 *(en tant que prototype)*

| Dimension | Note | Une phrase |
|---|---|---|
| Proposition de valeur | 3/10 | « Assistant juridique IA marocain » — indifférenciée, réplicable, non défendable |
| Positionnement | 2/10 | Mécanique B2C (essai gratuit, 20 questions) collée sur une ambition B2B enterprise |
| Cible | 3/10 | « Juriste marocain » n'est pas une cible ; « DJ d'une banque cotée en closing » en est une |
| Onboarding | 1/10 | Inexistant : compte provisionné, page Documents vide, aucune guidance |
| Expérience utilisateur | 3/10 | Outils isolés, `alert()` natifs, navigation morte, aucune continuité entre actions |
| Navigation | 2/10 | **6 liens de la sidebar pointent vers des pages qui n'existent pas** |
| Workflow réel d'un juriste | 2/10 | Le produit ignore l'unité de travail du métier : le dossier |
| Architecture applicative | 3/10 | Pages-îlots ; chaque page recopie sidebar, auth, styles et services |
| Cohérence | 3/10 | Trois styles de sidebar, deux systèmes de quota, deux grilles de risques |
| Vitesse d'utilisation | 4/10 | Pas de raccourcis, pas de palette de commandes, rechargements complets |
| Charge cognitive | 4/10 | L'utilisateur doit savoir *quel outil* ouvrir avant de savoir *quoi faire* |
| Visibilité de l'information | 3/10 | Aucune vue « qu'est-ce qui m'attend aujourd'hui ? » |

### Proposition de valeur — le problème de fond

La promesse actuelle (« posez une question juridique, analysez un contrat ») est la promesse de **tous** les wrappers GPT juridiques lancés depuis 2023. Harvey ne vend pas « un chat » : il vend des *workflows* (due diligence, review de fonds, litigation) avec un niveau de fiabilité contractualisable. Doctrine ne vend pas « de la recherche » : il vend l'exhaustivité (« si ce n'est pas dans Doctrine, ça n'existe pas »). Spellbook vend un lieu (Word). Luminance vend un résultat mesurable (X % de temps de review en moins).

Juria doit choisir sa phrase. Le comité recommande : **« Le système d'exploitation des opérations juridiques corporate finance au Maroc — chaque deal, chaque échéance, chaque clause, sourcé en droit marocain. »** Tout ce qui ne sert pas cette phrase doit être coupé.

### Le scandale silencieux : la navigation

La sidebar de production contient **Contreparties, Dossiers, Risques, Échéances, Timeline, Tâches** — six entrées qui redirigent toutes vers `documents.html`, dont trois avec un badge « — ». Pour un GC qui évalue l'outil en 10 minutes, c'est disqualifiant : cela signale un produit qui *promet* plus qu'il ne *fait*, exactement l'inverse de ce qu'exige un acheteur juridique. **À corriger avant toute démo.** Ironie : ces six liens morts sont précisément la roadmap que le produit aurait dû suivre.

### Fonctionnalités à supprimer (oui, supprimer)

- **La génération de contrats par chat.** Un contrat généré librement par gpt-4o-mini sans template validé par un avocat est un *passif*, pas une fonctionnalité. Aucun des douze concurrents ne fait de génération libre ; Spellbook et Litera génèrent depuis des *bibliothèques de modèles gouvernées*. À remplacer par une bibliothèque de templates marocains validés, avec variables. D'ici là : retirer.
- **Les « livrables » forcés en fin de chaque réponse.** Le prompt impose une section commerciale (« Je peux vous préparer : 1… 2… 3… ») à chaque réponse. Au 5ᵉ échange, c'est du spam. Un professionnel le remarque et le méprise.
- **Le quota « 20 questions » et le badge « Essai gratuit »** dans un produit vendu par provisioning à des organisations. Deux systèmes de quota coexistent (ancien par utilisateur, nouveau par organisation en crédits) ; l'ancien doit disparaître, et le mot « Essai gratuit » avec lui.
- **La détection de « conversation naturelle » par regex** (`bonjour|salut|merci…`) : fragile, et le cas ne mérite pas un chemin de code dédié.
- **Les six liens morts** (ou plus exactement : les remplacer par les vraies pages, cf. §8).

### Fonctionnalités manquantes structurantes

Dossiers/matters · échéancier & alertes · tâches & assignation · registre des obligations contractuelles · templates gouvernés · versions & redlines · exports Word fidèles · trail d'audit · intake des demandes internes · vue portefeuille · permissions par dossier · API. Détail aux sections 2–7.

---

# 2. AUDIT DIRECTION JURIDIQUE

*Rédigé par le GC et le DJ banque du comité.*

## La journée réelle

**8h30 — l'ouverture.** Le DJ ouvre Outlook, pas un outil juridique. Il cherche : qu'est-ce qui a bougé cette nuit (emails des conseils externes, signatures reçues), qu'est-ce qui expire (préavis, options, garanties), qui attend une réponse de moi (le business), où en sont mes deals. Aujourd'hui, **aucun logiciel ne lui donne cette vue au Maroc**. C'est la place à prendre : si Juria affiche à 8h30 « 3 échéances cette semaine, 2 contrats en attente de votre validation, le covenant X de la facilité Y passe en zone orange », le DJ l'ouvre tous les matins. C'est le test unique de ce rapport.

**Dans la journée.** 60–70 % du volume : revue de contrats entrants (NDA, fournisseurs, prestations, baux) contre les standards internes ; réponses rapides au business (« peut-on faire X ? ») ; validation de pouvoirs et de signatures ; coordination des conseils externes ; préparation de comités. Le reste : les deals.

**Pendant un closing.** Sa vie devient une checklist : la *CP list* (conditions précédentes), la *documents list*, le statut de signature de chaque document par chaque partie, le funds flow, les pouvoirs. Aujourd'hui il gère ça dans un tableau Excel envoyé par le cabinet, versionné par email, faux au bout de 3 heures. **Un CP tracker temps réel partagé avec le cabinet est, à lui seul, un motif d'achat.**

**Pendant une acquisition.** Data room à revoir (200–2 000 documents), red flags à remonter, marks sur le SPA, disclosure schedules à construire, garanties de passif à négocier, approbations corporate (conseil, AG, AMMC/Conseil de la concurrence le cas échéant) à orchestrer.

**Pendant une levée.** Term sheet, pactes d'actionnaires, gouvernance, table de capitalisation, déclarations et garanties des fondateurs, agrément Office des Changes si investisseur étranger.

**Pendant une émission obligataire.** Note d'information/prospectus, visa AMMC (calendrier strict), contrats de placement, représentant de la masse, covenants — puis **la vie post-émission** : reporting périodique, ratios, événements déclencheurs. Personne n'outille le post-closing ; tout le monde outille le closing.

**Pendant une restructuration / un refinancement.** Waivers à tracer, accords intercréanciers, paquet de sûretés (nantissements de titres, hypothèques, délégations), mainlevées, avenants en cascade. Le suivi des sûretés est aujourd'hui un classeur physique dans la plupart des banques marocaines.

## Le cockpit Juria — ce qui manque

| Manque | Sévérité |
|---|---|
| Page « Aujourd'hui » : échéances, tâches, deals actifs, alertes | Bloquant |
| Dossiers (matters) reliant documents, parties, tâches, conseils | Bloquant |
| Échéancier extrait automatiquement des contrats (préavis, renouvellements, expirations) avec alertes email | Bloquant |
| CP tracker / closing checklist partageable | Achat immédiat |
| Registre des obligations et covenants post-signature | Achat immédiat (banques, PE) |
| Intake : formulaire de demande pour le business + triage IA | Fort |
| Suivi des conseils externes (mandats, budgets, livrables) | Fort |
| Corporate housekeeping : registres sociaux, mandats, délégations de pouvoirs, échéances OMPIC | Fort |
| Reporting direction (activité, risques, coûts) | Moyen |

---

# 3. AUDIT CABINET D'AVOCATS

*Rédigé par l'associé et l'ex-Partner M&A.*

**Cabinet de 5 avocats.** Pas de DMS, tout est dans Outlook et un serveur de fichiers. Besoins : dossiers simples, templates du cabinet, review IA de premier passage, feuille de temps minimale. Prix acceptable : 100–200 €/avocat/mois si le gain est tangible. Juria peut les servir vite — c'est la beachhead.

**Cabinet de 20 avocats.** Apparaissent : le **contrôle des conflits d'intérêts** (impossible à vendre sans), la gestion du savoir (précédents retrouvables : « ressors-moi la clause d'earn-out du deal X »), la répartition du travail collaborateurs/associés, la review à plusieurs sur un même document. La **clause library** alimentée par les propres précédents du cabinet est la fonctionnalité à plus forte valeur : c'est le capital du cabinet, aujourd'hui enfermé dans des .docx.

**Cabinet de 100 avocats.** Murailles de Chine (ethical walls), intégration DMS (iManage est le standard mondial — il faudra soit s'y intégrer, soit le remplacer, et le remplacer est une guerre), facturation, sécurité opposable aux clients bancaires, SSO. Ne pas viser avant 24 mois.

**Ce qui fait gagner plusieurs heures par semaine, dans l'ordre :**
1. Review de premier passage contre le *playbook* du cabinet (positions acceptables/inacceptables par type de clause) — pas contre des généralités.
2. Due diligence : extraction structurée d'une data room entière (parties, durées, change of control, exclusivités, droits de résiliation) → tableau + rapport rouge/orange/vert.
3. Précédents retrouvables par clause (« toutes nos clauses de non-concurrence en distribution depuis 2023 »).
4. Bundles/closing sets générés automatiquement (bibles de closing : des journées de stagiaire).
5. Comparaison de versions fidèle (Litera Compare est le standard : Juria doit produire un vrai redline Word, pas un JSON de différences).

---

# 4. AUDIT CORPORATE FINANCE

*Rédigé par le DJ banque, l'ex-Partner M&A et le GC.*

| Segment | Besoins spécifiques | Modules Juria à construire |
|---|---|---|
| **Banques** | Revue de facility agreements, paquet de sûretés, covenant monitoring, waivers, conformité BAM, KYC documentaire | **Covenant Radar** (registre + alertes + certificats de conformité), **Security Register** (sûretés, rangs, mainlevées, échéances de renouvellement d'inscription), analyseur de conventions de crédit (définitions, cas de défaut, cross-default) |
| **Private Equity / fonds** | DD d'acquisition, pactes, management packages, obligations post-closing par participation, préparation des exits | **Vue Portefeuille** (obligations et échéances par participation), DD module, suivi des garanties de passif (durées, plafonds, franchises), data room de cession permanente (« exit-ready ») |
| **M&A** | Data room, red flags, SPA, disclosure schedules, CP, approbations réglementaires | **Deal Room + DD Agent + CP Tracker + SPA Analyzer** — le cœur du produit |
| **Project finance** | Concessions, accords directs, step-in rights, assurances, contrats EPC/O&M interdépendants | Cartographie des interdépendances contractuelles (le graphe de liens entre documents prend ici tout son sens) |
| **Immobilier** | Baux 49-16, titres fonciers, VEFA, hypothèques | Analyseur de baux avec règles loi 49-16 (déjà embryonnaire dans les prompts), registre des baux avec échéancier de renouvellement/révision |
| **Sociétés cotées** | Calendrier AMMC, information permanente/privilégiée, listes d'initiés, franchissements de seuils, gouvernance (CA, AG, PV) | **Calendrier réglementaire AMMC** pré-chargé, gestionnaire de listes d'initiés, générateur de convocations/PV/résolutions |

Le point commun : **tous ces modules sont des registres + des échéances + de l'extraction IA**. La même infrastructure (extraction structurée à l'ingestion, échéancier, alertes) sert les six segments. C'est l'argument architecture de la section 15.

---

# 5. AUDIT IA

*Rédigé par l'ex-ingénieur principal de Harvey.*

## Diagnostic

Le pipeline actuel (après les corrections récentes : map-reduce d'analyse, RAG avec seuil, historique) est **techniquement décent mais stratégiquement chat-first**. La leçon de Harvey et CoCounsel : les juristes n'achètent pas un chat, ils achètent des **workflows à résultat vérifiable** — un rapport de DD, un tableau de clauses, un mémo sourcé — où le chat n'est que la couche d'ajustement. Trois écarts majeurs :

1. **Tout tourne sur gpt-4o-mini** sauf la synthèse. Pour de l'analyse juridique vendue à des banques, le modèle frontière n'est pas un luxe : c'est la différence entre « détecte la clause de cross-default » et « la rate une fois sur quatre ». Le surcoût est de quelques dirhams par analyse — refacturables en crédits.
2. **Aucune évaluation.** Pas un seul test mesurant si un changement de prompt améliore ou dégrade. Harvey publie BigLaw Bench ; Juria ne sait pas si sa version d'hier était meilleure. Un jeu de 50 cas marocains réels (questions + réponses attendues + documents annotés) est le prérequis de toute industrialisation.
3. **Pas d'extraction structurée à l'ingestion.** Chaque document devrait produire, dès l'upload : parties (avec rôles), dates clés, montants, durée, droit applicable, juridiction, clauses typées (25–40 types), obligations datées. C'est ce qui alimente la recherche facettée (§7), l'échéancier (§2) et les registres (§4). Aujourd'hui l'ingestion ne produit que des chunks pour le RAG.

## Les agents à construire

Un « agent » utile = un workflow avec entrées définies, étapes outillées (recherche corpus + lecture documents + extraction), sortie structurée **avec citations**, et validation humaine. Jamais de génération libre.

**Vague 1 (différenciants immédiats)**
- **Due Diligence Agent** — data room → rapport red flags + tableau d'extraction + questions de DD. Le produit d'appel M&A.
- **Contract Review Agent (playbook-driven)** — review contre les positions de l'organisation, pas contre des généralités ; produit un redline annoté.
- **Deadline & Obligation Extractor** — chaque contrat ingéré alimente l'échéancier et le registre d'obligations. Invisible et indispensable.
- **CP / Signature Readiness Agent** — lit la CP list d'une convention, vérifie pièce par pièce ce qui est dans le dossier, statut de chaque signature et pouvoir associé.
- **Legal Memo Agent** — question → recherche corpus marocain → mémo sourcé structuré (déjà 60 % présent via la synthèse).

**Vague 2 (corporate/finance)**
- **SPA Agent** (garanties, indemnisation, ajustements de prix, earn-out — comparaison à la pratique de place), **Term Sheet Agent** (term sheet → liste de points de négociation + projet de documentation), **Covenant Monitoring Agent** (ratios, certificats, calendrier), **Board Resolution / Corporate Secretary Agent** (ordre du jour → convocations, résolutions, PV, formalités OMPIC), **Disclosure Schedule Builder**, **Conditions Precedent Agent**, **Risk Agent** (consolidation des risques au niveau portefeuille), **Compliance Agent** (AMMC/BAM : obligations applicables à l'entité).

**Vague 3 (spécialisés)**
- Defined Terms Checker (termes définis non utilisés / utilisés non définis — les juristes adorent), Cross-Reference Validator (renvois d'articles cassés), Signature & Pouvoirs Agent (qui signe, avec quelle délégation), Translation Agent FR↔AR juridique aligné, Precedent Finder (dans les propres documents de l'organisation), Negotiation History Agent (historique des concessions par contrepartie), Regulatory Watch Agent (veille BO/AMMC → impacts sur les contrats du portefeuille), Litigation Summarizer, Email-to-Matter Classifier, Redline Explainer (« que m'a concédé la partie adverse dans cette version ? »), Insurance Coverage Checker, Sanctions/PEP Screening (avec sources), Cap Table Agent, Waterfall Agent (clauses de liquidation préférentielle → simulation), Guarantee Tracker (durées/plafonds de garanties de passif).

## Ce que GPT sait faire aujourd'hui et que Juria n'exploite pas

Extraction structurée fiable en JSON contraint (le socle des registres) · comparaison sémantique multi-documents (cohérence SPA ↔ disclosure schedules ↔ data room) · usage agentique d'outils (recherche → lecture → itération, au lieu d'un RAG en un coup) · vision (tableaux scannés, signatures manuscrites, tampons — fréquents au Maroc) · arabe juridique (bilinguisme aligné = différenciateur régional majeur) · fine-tuning léger de classification (types de clauses marocaines).

---

# 6. AUDIT DOCUMENTS

Le module actuel est une **liste de fichiers avec analyse ponctuelle** — l'équivalent d'un explorateur Windows avec un bouton magique. Verdict sur chaque vue proposée :

| Vue | Verdict | Priorité |
|---|---|---|
| **Clause Explorer** | Indispensable. Navigation par clause typée dans un document ET transversale (« toutes les clauses de résiliation du portefeuille »). Luminance et Diligen ont bâti leur valeur dessus. Exige l'extraction structurée (§5). | P1 |
| **Version Compare** | Indispensable, mais au standard Litera : redline précis exportable Word, pas un tableau de différences. Le compare actuel (JSON ajout/suppression/modification) est un brouillon de la vraie fonctionnalité. | P1 |
| **Timeline** | Forte valeur en deux sens : timeline *du dossier* (versions, échanges, signatures) et timeline *extraite du contrat* (dates et obligations). | P1 (extraite) / P2 (dossier) |
| **Linked Documents** | Indispensable en corporate finance : un avenant sans son contrat-cadre est illisible. Liens typés (amende, remplace, met en œuvre, garantit). | P1 |
| **Annotations** | Nécessaire à la review collaborative (commentaires ancrés au passage, threads, résolution). | P2 |
| **Smart Summary** | Déjà présent (synthèse) — la meilleure brique actuelle. À ancrer par page/clause cliquable. | Fait à 70 % |
| **Bundles / Closing sets** | Bibles de closing générées (ordre canonique, pagination, index) — heures de travail paralégal économisées, différenciant local. | P2 |
| **Deal Room** | Data room légère (partage externe contrôlé, watermark, journal d'accès). Attention : ne pas concurrencer frontalement Datasite/Intralinks — viser la data room *de travail* du juriste, pas celle du process de vente. | P3 |
| **Knowledge Graph** | Le bon horizon (parties ↔ contrats ↔ clauses ↔ textes de loi), mais ne pas le vendre avant d'avoir les nœuds. Construire les liens dès maintenant dans le modèle de données, l'interface graphe attendra. | P3 (données P1) |
| **Cross References** | Dans le document (renvois cliquables + validation) : P2. Vers le corpus légal (« art. 231 du Code du Travail » cliquable) : P1, car c'est le pont vers la valeur Doctrine. | P1/P2 |
| **Bookmarks** | Trivial, faible valeur seul. | P3 |

**« Peut-il devenir meilleur que Doctrine ? »** — Question mal posée : Doctrine est meilleur sur le *droit* (corpus public), Juria peut être meilleur sur *les documents de l'organisation* (privés). La victoire est la jonction : chaque contrat privé relié aux textes marocains en vigueur *à sa date de signature*. Doctrine ne fait pas cela au Maroc et n'y viendra pas avant des années.

---

# 7. AUDIT RECHERCHE

*Rédigé par l'ex-Product Lead de Doctrine.*

La recherche actuelle (hybride vecteur+BM25 avec reranking sur la base légale ; vectorielle simple sur les chunks documentaires) est **au bon standard technique sur un corpus indigent**. Une Ferrari sur un parking : quelques codes, pas de jurisprudence, pas de BO, pas de versionnement.

**Architecture cible en trois couches :**

1. **Corpus public** (la course de fond) : BO ingéré à chaque parution, codes consolidés **versionnés dans le temps** (en vigueur à date T — crucial en contentieux et en opinion), jurisprudence Cour de cassation, circulaires AMMC/BAM/DGI/Office des Changes, conventions collectives. OCR bilingue AR/FR. Citations extraites automatiquement → graphe (« texte cité par », « modifié par », « abrogé par »).
2. **Index privé de l'organisation** : chaque document ingéré avec extraction structurée → recherche facettée par **clause, partie, montant, date, obligation, garantie, société, type d'acte, secteur, avocat responsable, dossier, statut**. C'est la liste exacte demandée — et chacun de ces filtres est une colonne produite par l'extraction de la §5, pas un module distinct.
3. **Couche de requête unifiée** : une seule barre (⌘K) qui comprend « clauses de change of control dans nos pactes signés après 2024 » (facettes + sémantique), le booléen strict pour les puristes (`"earn-out" AND NOT "locked box"`), et les recherches sauvegardées transformables en **alertes** (le pont vers la veille).

Le différenciateur que Doctrine n'a pas : la recherche **transversale privé↔public** (« nos contrats affectés par le nouvel article X publié au BO d'hier »). C'est la fonctionnalité de rétention ultime pour un DJ.

---

# 8. AUDIT UX — REFONTE

*Rédigé par le designer (Linear) et le Head of Product (Notion).*

Principes : **matter-centric** ; le clavier d'abord (⌘K omniprésent) ; densité professionnelle (un juriste vit dans des tableaux, pas dans des cards aérées) ; zéro modale bloquante ; chaque écran répond à « que dois-je faire maintenant ? ».

### Nouvelle sidebar (remplace l'actuelle)

```
┌────────────────────────┐
│ ⌘K  Rechercher…        │
├────────────────────────┤
│ ◉ Aujourd'hui          │   ← page d'accueil, la vue 8h30
│ ▤ Dossiers             │   ← l'objet racine (deals, contentieux…)
│ ▦ Documents            │
│ ◷ Échéances            │
│ ☑ Tâches               │
│ ✦ Assistant            │   ← le chat, relié au contexte courant
│ ⌂ Base juridique       │   ← corpus public + veille
├────────────────────────┤
│ ▣ Portefeuille    (PE) │   ← modules par segment, activables
│ ⚑ Covenants   (Banque) │
├────────────────────────┤
│ ⚙ Administration       │
└────────────────────────┘
```

### « Aujourd'hui » — le cockpit 8h30

```
┌──────────────────────────────────────────────────────────────────────┐
│ Mardi 9 juillet — Bonjour, Anas                    [⌘K] [+ Nouveau]  │
├──────────────────────┬───────────────────────────────────────────────┤
│ ÉCHÉANCES            │ MES DOSSIERS ACTIFS                           │
│ ● 12/07 Préavis bail │ ▸ Projet Atlas (acquisition)   CP 14/23 ✓     │
│   Casablanca Anfa    │   ⚠ 2 red flags DD non traités                │
│ ● 15/07 Certificat   │ ▸ Refinancement BMCE 450 MMAD  Waiver signé   │
│   covenant T2 — BCP  │ ▸ Émission obligataire — visa AMMC J-6        │
│ ● 18/07 Expiration   │                                               │
│   garantie passif    │ EN ATTENTE DE MOI                             │
│   (cession Yara)     │ □ Valider NDA — Maroc Telecom (IA: conforme,  │
├──────────────────────┤   1 écart playbook : durée 5 ans vs 3 ans)    │
│ VEILLE               │ □ Relire résolutions CA du 21/07              │
│ ⚡ BO n°7412 : décret │ □ Répondre à la Direction Achats (délégation) │
│   application loi    ├───────────────────────────────────────────────┤
│   Impact: 3 contrats │ ACTIVITÉ  Sara a commenté SPA v4 · il y a 2h  │
└──────────────────────┴───────────────────────────────────────────────┘
```

### Vue Dossier (deal M&A)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◂ Dossiers / Projet Atlas — Acquisition 100% Atlas Bottling          │
│ [Aperçu] [Documents 214] [DD] [CP Tracker] [Parties] [Tâches] [IA]   │
├──────────────────────────────────────────────────────────────────────┤
│ Statut: Signing → Closing   Cible: 28/07   Conseil: UGGC Casablanca  │
│──────────────────────────────────────────────────────────────────────│
│ CP TRACKER                                            14/23 remplies │
│ ✓ Approbation Conseil de la concurrence      reçue 02/07  [pièce]    │
│ ✓ Résolutions CA vendeur                     reçue 05/07  [pièce]    │
│ ◐ Mainlevée nantissement BCP        relance envoyée 08/07 — J. Alami │
│ ○ Certificat de non-faillite OMPIC              assigné: stagiaire   │
│ ⚠ Agrément Office des Changes       IA: pièce absente de la data room│
│──────────────────────────────────────────────────────────────────────│
│ RED FLAGS DD (7)   ● Change of control — contrat Coca-Cola  [voir §] │
│                    ● Exclusivité distribution non cédable   [voir §] │
└──────────────────────────────────────────────────────────────────────┘
```

### Clause Explorer (transversal)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Clauses ▸ Change of control          214 documents · 37 occurrences  │
│ Filtres: [Dossier ▾] [Type d'acte ▾] [Après 2023 ▾] [Contrepartie ▾] │
├────────────────────────────┬─────────────────────────────────────────┤
│ Contrat Coca-Cola 2021     │ « En cas de changement de contrôle de   │
│ ⚠ Consentement préalable   │ l'Embouteilleur, le Concédant pourra    │
│ Contrat-cadre OCP 2023     │ résilier de plein droit… » (art. 17.2)  │
│ ○ Simple notification      │                                         │
│ Bail Anfa Place 2022       │ [Comparer à la pratique de place]       │
│ ⚠ Résiliation de plein     │ [Voir dans le document] [Exporter]      │
│   droit                    │ IA: 12/37 clauses sont « hostiles » —   │
│ …                          │ liste pour la DD ▸                      │
└────────────────────────────┴─────────────────────────────────────────┘
```

### Échéances — vue Calendrier + liste

```
┌──────────────────────────────────────────────────────────────────────┐
│ Échéances   [Liste] [Calendrier] [Par dossier]     + Ajouter · ⚙ Règles │
├──────────────────────────────────────────────────────────────────────┤
│ JUILLET 2026                                                         │
│ L   M   M   J   V   S   D                                            │
│ 7   8  (9) 10  11  12  13     12/07 ● Préavis bail Anfa (J-3 ⚠)      │
│                    ●          15/07 ● Certificat covenant BCP        │
│ 14  15  16  17  18  19  20    18/07 ● Expiration garantie passif     │
│     ●           ●             28/07 ◆ Closing Projet Atlas           │
│ Origine: 84% extraites par IA, 16% manuelles · Alertes: email J-30/J-7/J-1 │
└──────────────────────────────────────────────────────────────────────┘
```

### Portefeuille (PE) et Tâches (Kanban)

```
┌───────────── PORTEFEUILLE ─────────────┐  ┌───────── TÂCHES ─────────┐
│ Participation  Oblig.  Échéances  Risq │  │ À faire │ En cours │ Fait │
│ Atlas Bottling   12    2 ce mois   ⚠2  │  │ ▢ CP    │ ▢ Revue  │ ▢ NDA│
│ Medtech SA        8    —           ●   │  │ OMPIC   │ SPA v4   │ MT   │
│ AgriHold         23    5 ce mois   ⚠5  │  │ ▢ PV AG │ (Sara)   │      │
│ [+ Simuler exit: points juridiques]    │  │ (moi)   │          │      │
└────────────────────────────────────────┘  └──────────────────────────┘
```

---

# 9. AUDIT DESIGN

**Verdict : 4/10. Propre pour un prototype, pas « 1 000 €/mois ».** Ce qui trahit :

- **Les emojis comme iconographie** (🚪 déconnexion, 🗑️ suppression, ⚡ crédits, 📊 licences). Aucun produit premium n'utilise d'emojis dans sa chrome. Remplacer par un set SVG unique (Lucide, déjà partiellement présent — l'incohérence emoji/SVG est pire que l'un ou l'autre).
- **Les `alert()` et `confirm()` natifs** pour des actions critiques (suppression d'utilisateur, transmission de mot de passe !). C'est l'anti-premium absolu. Toasts, modales propres, undo.
- **L'incohérence inter-pages** : chaque page HTML recopie et fait dériver ses styles (trois variantes de sidebar, boutons différents entre superadmin et administration). Sans build system, la dérive est structurelle — argument design de la réécriture (§10).
- **La densité** : cards aérées et généreuses là où le métier veut des tableaux denses, triables, à colonnes configurables. Regarder Linear : 13px, interlignes serrés, information d'état encodée par pastilles.
- **Typographie** : Inter + DM Serif Display est un choix correct (le serif donne l'ancrage « juridique ») mais sous-exploité : hiérarchie plate, pas de tabular-nums sur les montants/dates — impardonnable pour du corporate finance.
- **Pas de dark mode**, pas de densité configurable, pas d'états vides travaillés (l'état vide actuel : « Aucun utilisateur » ; l'état vide premium explique quoi faire et pré-remplit).
- **Animations** : quasi absentes — c'est préférable à l'excès ; ajouter uniquement des transitions d'état sobres (120–200 ms) et des skeletons de chargement à la place des « Chargement… » texte.

Prescription : design system tokenisé (couleurs sémantiques, échelle typographique, espacements 4px, rayons, ombres), thème sombre natif, iconographie unique, composants (Table, Modal, Toast, EmptyState, StatusPill, CommandPalette) — livré avec la réécriture front, jamais en patch sur l'existant.

---

# 10. AUDIT TECHNIQUE

*Rédigé par le CTO SaaS et l'ex-ingénieur Harvey. Sans anesthésie.*

## Le front : à réécrire, sans débat

15+ pages HTML de 1 500 à 3 500 lignes, JavaScript inline ES5/ES6 mélangé, **duplication massive** (sidebar, auth-guard, helpers, styles recopiés puis divergents ; le chunking existe en trois exemplaires dont deux divergents), pas de framework, pas de TypeScript, pas de composants, pas de tests (zéro test dans tout le repo), pas de linter. Chaque correction doit être reportée à la main sur N pages — le bug « rôle viewer inexistant » corrigé cette semaine existait à deux endroits pour cette raison exacte. À l'échelle d'une équipe de 5+ développeurs, ce front génère plus de régressions qu'il ne permet de features. **Réécriture : React/Next.js + TypeScript + design system, 8–10 semaines pour un périmètre supérieur à l'existant.** La logique métier (prompts, flux Supabase) se transpose ; rien d'autre.

## Le backend : conservable à moyen terme, avec des réserves

- **Supabase** : choix défendable jusqu'à la série A. Multi-tenant par RLS correct dans l'ensemble mais **la surface d'erreur est énorme** — cette session seule a mis au jour : politiques permissives héritées (`USING (true)` sur le contenu des documents, corrigé), un contrôle d'accès qui interrogeait une colonne inexistante (403 systématique sur l'indexation, silencieux pendant des semaines), des ids non-uuid rejetés en boucle. Chaque table ajoutée est un risque de fuite inter-tenants. Prescription : tests RLS automatisés par rôle (anonyme/membre/admin/autre-org) sur chaque table, exécutés en CI.
- **Un seul environnement = la prod.** Pas de staging, migrations appliquées à la main via workflow sur la base de production, fichiers de diagnostic mélangés aux migrations. Inacceptable au-delà de 3 clients payants : créer projet staging + promotion par CI immédiatement.
- **Edge functions** : `smart-endpoint` est un routeur de 800 lignes qui mélange chat général, doc-QA, comparaison, analyse, génération, livrables — à éclater par domaine. Secrets (`SERVICE_ROLE_KEY` vs `SUPABASE_SERVICE_ROLE_KEY`) incohérents entre fonctions. Pas de timeout/retry uniformes sur OpenAI (un seul endpoit a un timeout, 15 s).
- **Ingestion côté client** : l'extraction PDF/DOCX se fait dans le navigateur (pdf.js chargé depuis un CDN au moment de l'upload !). Conséquences : résultats non reproductibles, pas d'OCR possible (scans arabes = échec silencieux), pipeline non rejouable, dépendance CDN en prod. À déplacer côté serveur (queue + worker), prérequis de toute la §5.
- **RAG** : chunking naïf sans chevauchement, `page_number` factice (toujours 1 — les citations « page ? » le trahissent), pas de contextual retrieval, pas de BM25 sur les chunks privés. Correct après les correctifs récents, mais une génération derrière l'état de l'art 2025.
- **Coût OpenAI** : quotas en « crédits » internes, mais **aucune mesure du coût réel** (tokens in/out par appel, par org, par feature). On pilote un COGS à l'aveugle. Ajouter la télémétrie de tokens sur chaque appel, table `ai_calls` (org, feature, modèle, tokens, latence, coût).
- **Sécurité entreprise** : pas de SSO/SAML, pas de MFA imposable, pas de journal d'audit consultable, protection « leaked passwords » désactivée, mots de passe transmis en clair via `alert()` à l'admin, pas de chiffrement applicatif des documents, pas de DPA/mentions de conformité (loi 09-08 marocaine, RGPD pour l'international). **Une banque ne signera pas.** C'est un chantier produit, pas un détail.
- **Observabilité** : `console.log` uniquement. Pas de Sentry, pas de tracing, pas d'alerting. Le bug d'indexation (403 permanent) est resté invisible précisément pour cette raison.

## Verdict investisseur sur la tech

La valeur technique réelle réside dans : le schéma multi-tenant, le système de quotas/facturation interne, les prompts affinés sur le droit marocain, et la vélocité démontrée. Tout le reste se réécrit en un trimestre par une équipe senior — **on n'investit pas dans ce code, on investit dans l'équipe, le corpus et la fenêtre de marché.** Ce n'est pas une insulte : c'est la définition d'un seed réussi qui doit maintenant changer d'ère.

---

# 11. ROADMAP

**Phase 1 — 2 semaines : arrêter de saigner.**
Supprimer les 6 liens morts, la génération de contrat libre, les livrables forcés, l'ancien quota 20 questions ; remplacer emojis/alerts critiques ; créer le projet Supabase staging + interdire le SQL manuel en prod ; poser la télémétrie de coût OpenAI ; premier jeu d'éval (50 cas) ; tests RLS automatisés. *Aucune feature nouvelle : de la crédibilité.*

**Phase 2 — 1 mois : les fondations du vrai produit.**
Démarrer le nouveau front (app shell, design system, ⌘K, pages Aujourd'hui + Dossiers + Documents migrées) ; **modèle de données matter-centric** (dossiers, parties, tâches, échéances) ; ingestion serveur (queue, extraction, OCR AR/FR) avec **extraction structurée** (parties, dates, montants, clauses typées, obligations) ; échéancier + alertes email. À la fin de la phase 2, le test « 8h30 » devient passable.

**Phase 3 — 2 mois : les modules qui font signer.**
DD module (data room → rapport red flags + tableau) ; CP tracker partageable ; Clause Explorer ; recherche facettée privée ; comparaison au standard redline Word ; review contre playbook ; pipeline corpus v1 (BO + codes versionnés + Cour de cassation) ; annotations collaboratives. Bascule complète sur le nouveau front, dépréciation des pages legacy.

**Phase 4 — 6 mois : l'écart défendable.**
Veille réglementaire → impact sur le portefeuille (privé↔public) ; Covenant Radar + Security Register (module banque) ; vue Portefeuille PE ; add-in Word ; SSO/SAML + journal d'audit + dossier de conformité (certification en route) ; API publique ; agents vague 2 ; bilinguisme AR aligné ; préparation OHADA (l'expansion : 17 pays, un droit des affaires unifié — l'avantage géographique le plus sous-coté du projet).

---

# 12. LES 173 FONCTIONNALITÉS

★★★★★ indispensable · ★★★★ très utile · ★★★ utile · ★★ gadget · ★ inutile

**Socle & plateforme**
1. ★★★★★ Page « Aujourd'hui » (cockpit)
2. ★★★★★ Dossiers/matters comme objet racine
3. ★★★★★ Palette de commandes ⌘K globale
4. ★★★★★ Échéancier central avec alertes email
5. ★★★★★ Tâches assignables (liste + Kanban)
6. ★★★★★ Journal d'audit consultable
7. ★★★★ Notifications in-app + email digest quotidien
8. ★★★★ Recherches sauvegardées → alertes
9. ★★★★ Modèle de permissions par dossier
10. ★★★★ Intake des demandes internes (formulaire + triage IA)
11. ★★★ Rapports d'activité direction (PDF mensuel)
12. ★★★ Champs personnalisés par organisation
13. ★★★ Import en masse (migration depuis serveur de fichiers)
14. ★★★ Corbeille / restauration
15. ★★ Thèmes personnalisés par organisation
16. ★★ Page publique de statut
17. ★ Gamification de l'usage
18. ★ Fil social interne

**Dossiers / Matters**
19. ★★★★★ Types de dossiers (M&A, financement, contentieux, corporate, immobilier)
20. ★★★★★ Vue dossier : documents, parties, tâches, échéances, IA contextuelle
21. ★★★★★ CP tracker / closing checklist partageable (interne + conseil externe)
22. ★★★★ Statuts de deal (pipeline: NDA → DD → signing → closing → post-closing)
23. ★★★★ Parties & contreparties (registre, historique par contrepartie)
24. ★★★★ Suivi des conseils externes (mandats, budgets, échanges)
25. ★★★★ Timeline du dossier (événements, versions, décisions)
26. ★★★ Budget juridique par dossier
27. ★★★ Modèles de dossiers (checklist type par opération)
28. ★★★ Clôture de dossier avec bible générée
29. ★★★ Conflits d'intérêts (check à l'ouverture) — ★★★★★ pour cabinets
30. ★★★ Confidentialité renforcée par dossier (ethical walls)
31. ★★★ Duplication de dossier
32. ★★ Prévision de charge par juriste
33. ★★ Score de « santé » du deal
34. ★ Météo du dossier en emoji

**Documents**
35. ★★★★★ Ingestion serveur avec OCR FR/AR
36. ★★★★★ Extraction structurée à l'upload (parties, dates, montants, clauses, obligations)
37. ★★★★★ Visionneuse avec citations ancrées (page/paragraphe réels)
38. ★★★★★ Versions + redline exportable Word
39. ★★★★★ Documents liés typés (avenant, annexe, garantie, remplace)
40. ★★★★ Clause Explorer (par document et transversal)
41. ★★★★ Annotations collaboratives ancrées
42. ★★★★ Statuts documentaires (brouillon, en négociation, signé, expiré)
43. ★★★★ Bundles / bibles de closing générées
44. ★★★★ Renvois internes cliquables + validation des références croisées
45. ★★★★ Résumé intelligent ancré (existant, à ancrer)
46. ★★★ Templates gouvernés avec variables (remplace la génération libre)
47. ★★★ Tags et dossiers virtuels
48. ★★★ Détection de doublons
49. ★★★ Signature électronique (intégration, pas développement)
50. ★★★ Watermarking à l'export
51. ★★★ Data room de travail (partage externe contrôlé)
52. ★★ Aperçu miniature des pages
53. ★★ Statistiques de lecture
54. ★ Éditeur de texte riche intégré (ne pas concurrencer Word)

**M&A / Due Diligence**
55. ★★★★★ DD Agent : data room → rapport red flags sourcé
56. ★★★★★ Tableau d'extraction DD (une ligne par contrat, colonnes standard)
57. ★★★★ Q&A list de DD générée et suivie
58. ★★★★ SPA Analyzer (garanties, indemnisation, prix, comparaison pratique de place)
59. ★★★★ Disclosure Schedule Builder (croisement DD ↔ déclarations)
60. ★★★★ Suivi post-closing des garanties de passif (durées, plafonds, franchises)
61. ★★★ Term Sheet Agent (term sheet → points de négociation)
62. ★★★ Checklist réglementaire d'opération (concurrence, Office des Changes, AMMC)
63. ★★★ Earn-out tracker
64. ★★★ Comparateur de pactes d'actionnaires
65. ★★ Simulateur de waterfall (liquidation préférentielle)
66. ★★ Générateur de structure d'acquisition (organigrammes)

**Banque / Financement**
67. ★★★★★ Covenant Radar (registre, ratios, certificats, alertes)
68. ★★★★★ Security Register (sûretés, rangs, inscriptions, mainlevées, renouvellements)
69. ★★★★ Analyseur de conventions de crédit (définitions, defaults, cross-default)
70. ★★★★ Waiver tracker
71. ★★★ Registre des garanties données/reçues groupe
72. ★★★ Échéancier des utilisations et remboursements
73. ★★★ Conformité BAM documentaire
74. ★★ Comparateur de term sheets bancaires
75. ★★ Calculateur de commissions

**Sociétés cotées & gouvernance**
76. ★★★★ Calendrier réglementaire AMMC pré-chargé
77. ★★★★ Corporate Secretary Agent (convocations, résolutions, PV, formalités)
78. ★★★★ Registre des mandats sociaux et délégations de pouvoirs
79. ★★★★ Gestion des listes d'initiés
80. ★★★ Suivi des franchissements de seuils
81. ★★★ Board pack generator
82. ★★★ Registre des conventions réglementées
83. ★★★ Échéances OMPIC / registre du commerce
84. ★★ Portail administrateurs
85. ★★ Vote électronique AG

**Recherche & corpus**
86. ★★★★★ Corpus BO ingéré en continu
87. ★★★★★ Codes consolidés versionnés dans le temps
88. ★★★★★ Recherche facettée privée (clause, partie, montant, date, type d'acte…)
89. ★★★★★ Barre unifiée privé + public (⌘K)
90. ★★★★ Jurisprudence Cour de cassation indexée
91. ★★★★ Circulaires sectorielles (AMMC, BAM, DGI, Office des Changes)
92. ★★★★ Graphe de citations légales (cité par, modifié par, abrogé par)
93. ★★★★ Alerte « nouveau texte → contrats impactés »
94. ★★★ Recherche booléenne stricte
95. ★★★ Articles cliquables dans les documents privés (pont privé→public)
96. ★★★ Historique et partage de recherches
97. ★★★ Conventions collectives indexées
98. ★★ Doctrine académique marocaine
99. ★★ Traductions officielles alignées FR/AR des textes
100. ★ Recherche vocale

**IA & agents**
101. ★★★★★ Review contre playbook de l'organisation
102. ★★★★★ Extraction d'échéances et obligations (alimente tout le reste)
103. ★★★★★ Mémo juridique sourcé (industrialiser l'existant)
104. ★★★★★ Jeu d'évaluation interne + score qualité par version
105. ★★★★ CP/Signature Readiness Agent
106. ★★★★ Redline Explainer (« que change cette version ? »)
107. ★★★★ Defined Terms Checker
108. ★★★★ Traduction juridique FR↔AR alignée
109. ★★★★ Modèle frontière sur l'analyse (A/B mesuré)
110. ★★★★ Chat multi-documents à l'échelle du dossier (« Ask the Deal »)
111. ★★★ Compliance Agent (obligations applicables à l'entité)
112. ★★★ Precedent Finder interne
113. ★★★ Negotiation History par contrepartie
114. ★★★ Email-to-Matter Classifier
115. ★★★ Cross-Reference Validator
116. ★★★ Pouvoirs & signatures (qui peut signer quoi)
117. ★★★ Litigation Summarizer
118. ★★★ Détection de clauses inhabituelles (vs corpus interne)
119. ★★ Sanctions/PEP screening sourcé
120. ★★ Insurance Coverage Checker
121. ★★ Estimation de durée de négociation
122. ★ Prédiction d'issue contentieuse (dangereux sans données locales)
123. ★ Chatbot public non authentifié

**Collaboration**
124. ★★★★ Commentaires et mentions @
125. ★★★★ Partage externe contrôlé (conseil, contrepartie) avec journal
126. ★★★★ Revue à deux niveaux (collaborateur → associé/DJ)
127. ★★★ Espaces par équipe/practice
128. ★★★ Historique d'activité par dossier
129. ★★★ Mode présentation (comité, board)
130. ★★ Édition simultanée de notes
131. ★★ Visioconférence intégrée — ★ en vrai : inutile
132. ★★★ Export « pack client » (rapport DD brandé cabinet)

**Administration, sécurité, conformité**
133. ★★★★★ SSO/SAML + MFA
134. ★★★★★ Journal d'audit exportable (accès, actions, IA)
135. ★★★★★ Gestion fine des rôles (practice, dossier, lecture seule externe)
136. ★★★★ Dossier de conformité (09-08, RGPD, hébergement, chiffrement)
137. ★★★★ Rétention et suppression programmée des données
138. ★★★★ Chiffrement applicatif des documents sensibles
139. ★★★ Politique de mots de passe + fin de la transmission en clair
140. ★★★ IP allowlisting par organisation
141. ★★★ Sauvegarde/export intégral par organisation
142. ★★★ SCIM (provisioning automatique)
143. ★★ Certificats de destruction
144. ★★ BYOK (bring your own key)

**Intégrations**
145. ★★★★★ Add-in Word (review, clauses, comparaison dans Word)
146. ★★★★ Outlook (email → dossier, extraction de pièces)
147. ★★★★ Calendrier (échéances → Outlook/Google)
148. ★★★ DocuSign/local e-signature
149. ★★★ API publique + webhooks
150. ★★★ Import iManage/NetDocuments (cabinets 50+)
151. ★★★ Slack/Teams notifications
152. ★★ Zapier/Make
153. ★★ Comptabilité cabinet (facturation)
154. ★ Extension Chrome générique

**UX/Design**
155. ★★★★★ Design system unifié + composants
156. ★★★★★ Tableaux denses triables à colonnes configurables
157. ★★★★ Dark mode
158. ★★★★ Raccourcis clavier complets
159. ★★★★ États vides intelligents (guidage)
160. ★★★ Skeletons et optimistic UI
161. ★★★ Vues sauvegardées par utilisateur
162. ★★★ Densité configurable
163. ★★ Animations de célébration closing
164. ★ Avatars personnalisés

**Corpus & data (rappel transverse)**
165. ★★★★★ Versionnement temporel des textes (en vigueur à date T)
166. ★★★★ OCR arabe de qualité production
167. ★★★★ Détection automatique du type d'acte à l'upload
168. ★★★ Base de données des juridictions et délais de procédure
169. ★★★ Barème des droits d'enregistrement et timbres
170. ★★ Annuaire des notaires/adouls/huissiers
171. ★★★ Modèles de formalités (OMPIC, ANCFCC, CNSS)
172. ★★ Statistiques de jurisprudence par juridiction
173. ★ NFT de closing (non, vraiment)

---

# 13. EFFET WOW

1. **Deal Autopilot** — glisser 200 documents de data room ; 45 minutes plus tard : rapport de DD structuré rouge/orange/vert, tableau d'extraction, CP list générée, Q&A list, chaque ligne cliquable vers le passage source. C'est la démo qui clôt les ventes M&A.
2. **« Nos contrats viennent de changer »** — le BO de ce matin publie un décret ; à 9h04, Juria affiche : « 7 contrats de votre portefeuille contiennent des clauses affectées » avec les passages. Personne au monde ne fait ça sur le droit marocain.
3. **Ask the Deal** — une question posée à *tout un dossier* (SPA + pacte + facility + garanties) : « quelles approbations manquent pour signer vendredi ? » — réponse croisée multi-documents avec sources.
4. **Miroir FR/AR** — le même contrat affiché côte à côte français/arabe, clauses alignées, divergences de traduction surlignées. Différenciant régional absolu (et réutilisable dans tout le Maghreb et le Golfe).
5. **Time Machine juridique** — « montre-moi ce contrat sous le droit en vigueur à sa date de signature » vs aujourd'hui : chaque référence légale re-résolue dans le temps.
6. **Closing Room live** — la CP list partagée en lecture avec le cabinet et la banque, mise à jour en temps réel, chaque pièce vérifiée par IA à son dépôt ; le jour J, un bouton « Generate closing bible ».
7. **Mémoire des négociations** — « la dernière fois que nous avons négocié avec X, ils ont cédé sur la garantie à 18 mois » — l'historique des concessions par contrepartie, extrait des versions successives.

---

# 14. VISION À 5 ANS

**Mission : rendre chaque engagement juridique d'une entreprise africaine visible, daté, sourcé et actionnable.**

Dans 5 ans, Juria n'est pas « un assistant IA » : c'est **la mémoire juridique opérationnelle** des directions juridiques et cabinets d'affaires — l'endroit où vivent les dossiers, où les échéances ne se perdent jamais, où chaque clause du portefeuille est connue, où chaque évolution du droit est instantanément croisée avec les engagements existants. L'IA y est ambiante, plus revendiquée.

Trajectoire géographique : **Maroc (2026-2027) → zone OHADA (2027-2029)** — 17 pays, un droit des affaires *unifié* : un seul corpus à construire pour 17 marchés sans concurrent local sérieux, l'opportunité la plus asymétrique du projet — **→ Afrique anglophone/Golfe ou France ensuite**, la France en dernier : c'est le seul marché où Doctrine, Harvey et Legora sont déjà retranchés.

À cet horizon, la ligne de revenus dominante n'est plus le siège utilisateur mais le **module** (Covenant Radar, DD, Cotées) et le **corpus** — le modèle Doctrine + le modèle Harvey, sur un continent où personne n'a encore posé les rails.

---

# 15. PLAN D'EXÉCUTION — LES 50 AMÉLIORATIONS, PAR ROI DÉCROISSANT

Légende : 🗄 migrations/tables · ⚡ edge functions · 🧩 front/composants · 🤖 prompts/IA

| # | Amélioration | Artefacts principaux |
|---|---|---|
| 1 | Supprimer liens morts, génération libre, livrables forcés, quota 20 questions, badge Essai | 🧩 toutes pages sidebar ; ⚡ smart-endpoint (retrait blocs contract/deliverable/greeting, `user_profiles_compat`) |
| 2 | Cockpit « Aujourd'hui » v1 (échéances + tâches + dossiers actifs) | 🧩 `app/today` ; 🗄 `deadlines`, `tasks` ; ⚡ `daily-digest` (cron email) |
| 3 | Modèle matter-centric | 🗄 `matters`, `matter_documents`, `matter_parties`, `matter_members` (+RLS testée) ; 🧩 `app/matters` |
| 4 | Extraction structurée à l'ingestion | ⚡ `ingest-document` (queue + OCR + extraction) ; 🗄 `document_facts`, `document_clauses`, `obligations` ; 🤖 prompt extraction JSON strict (parties, dates, montants, 30 types de clauses, obligations datées) |
| 5 | Échéancier + alertes email | 🗄 `deadlines` (source: extraction/manuel) ; ⚡ cron `deadline-alerts` ; 🧩 vue calendrier/liste |
| 6 | Ingestion serveur (fin du pdf.js client) | ⚡ `ingest-document` ; storage upload direct ; worker OCR AR/FR |
| 7 | Jeu d'éval + télémétrie coût IA | 🗄 `ai_calls`, `eval_cases`, `eval_runs` ; ⚡ wrapper OpenAI commun (tokens, latence, coût) ; CI d'éval |
| 8 | Staging + tests RLS en CI | Projet Supabase staging ; suite pgTAP/scripts par rôle ; workflow promotion |
| 9 | CP Tracker partageable | 🗄 `checklists`, `checklist_items` (statut, assigné, pièce liée) ; 🧩 vue closing ; ⚡ `cp-verify` (🤖 vérification pièce/exigence) |
| 10 | Nouveau front — app shell + design system | 🧩 Next.js/TS, tokens, Table/Modal/Toast/EmptyState/StatusPill/⌘K |
| 11 | DD module v1 | ⚡ `dd-run` (map data room → red flags + tableau) ; 🗄 `dd_reports`, `dd_findings` ; 🤖 grille DD marocaine |
| 12 | Review contre playbook | 🗄 `playbooks`, `playbook_rules` ; 🤖 review par règle avec verdict/écart/suggestion ; 🧩 éditeur de playbook |
| 13 | Clause Explorer | s'appuie sur `document_clauses` (#4) ; 🧩 vue transversale filtrable |
| 14 | Recherche facettée privée + ⌘K | index sur `document_facts/clauses` ; ⚡ `search` unifiée (hybride + facettes) |
| 15 | Corpus BO pipeline v1 | ⚡ `corpus-ingest` (BO scraping/OCR/découpage) ; 🗄 `legal_texts`, `legal_versions`, `legal_citations` |
| 16 | Codes versionnés dans le temps | 🗄 `legal_versions` (vigueur from/to) ; résolution à date |
| 17 | Redline Word fidèle | remplacement du compare JSON par diff exportable .docx (lib docx) ; 🤖 explication des changements en surcouche |
| 18 | Documents liés typés | 🗄 `document_links(type)` ; 🧩 panneau relations |
| 19 | Obligations/covenants registre | 🗄 `obligations` (déjà #4) + vues par dossier/portefeuille ; alertes |
| 20 | Journal d'audit | 🗄 `audit_log` (trigger + edge) ; 🧩 console admin |
| 21 | Annotations ancrées | 🗄 `annotations` (doc, ancre char, thread) ; 🧩 visionneuse |
| 22 | Visionneuse avec vraies pages | conserver la pagination à l'ingestion (#6) ; citations page/¶ réelles |
| 23 | Intake des demandes | 🗄 `requests` ; 🧩 formulaire léger ; 🤖 triage/priorité |
| 24 | Modèle frontière sur analyse (A/B) | ⚡ paramètre modèle (mécanisme existant côté synthèse) ; mesuré via #7 |
| 25 | Ask the Deal (chat multi-docs du dossier) | ⚡ RAG scoped matter ; 🤖 croisement inter-documents |
| 26 | Templates gouvernés | 🗄 `templates`, variables ; 🧩 génération guidée ; remplace définitivement la génération libre |
| 27 | Chunking v2 (overlap + BM25 privé + contextual) | ⚡ ingestion ; 🗄 index FTS sur chunks ; migration réindexation |
| 28 | SSO/SAML + MFA | Supabase Auth SAML (plan) ou WorkOS ; 🧩 settings org |
| 29 | Bundles / bibles de closing | ⚡ `bundle-build` (ordre, index, pagination) |
| 30 | Suivi conseils externes | 🗄 `external_counsel`, mandats/budgets ; 🧩 vue dossier |
| 31 | Covenant Radar (banque) | registres #19 + certificats + calendrier + alertes dédiées |
| 32 | Security Register | 🗄 `securities` (type, rang, inscription, échéance renouvellement) |
| 33 | Veille → impact portefeuille | ⚡ diff BO quotidien → matching clauses/citations privées ; notification |
| 34 | Corporate Secretary v1 | 🤖 convocation/résolutions/PV depuis ordre du jour ; 🗄 `mandates` (mandats, délégations) |
| 35 | Vue Portefeuille PE | agrégations obligations/échéances par participation |
| 36 | Add-in Word | projet Office.js ; review/clauses dans Word |
| 37 | Traduction FR↔AR alignée | 🤖 traduction par segment + alignement ; 🧩 vue miroir |
| 38 | Q&A list DD | 🗄 `dd_questions` ; génération + suivi |
| 39 | Disclosure Schedule Builder | 🤖 croisement DD findings ↔ déclarations SPA |
| 40 | Partage externe contrôlé | liens signés, watermark, journal (#20) |
| 41 | Calendrier réglementaire AMMC | 🗄 seed `regulatory_calendar` ; abonnement par entité |
| 42 | Notifications & digest | ⚡ cron digest ; préférences utilisateur |
| 43 | Rôles fins par dossier | extension RLS `matter_members(role)` |
| 44 | Defined Terms + Cross-ref Checker | 🤖 deux passes dédiées ; 🧩 panneau qualité du document |
| 45 | Precedent Finder interne | recherche par clause (#13) + similarité |
| 46 | Historique de négociation par contrepartie | dérivé des versions (#17) + `matter_parties` |
| 47 | API publique + webhooks | gateway + clés par org ; docs |
| 48 | Import en masse | ⚡ batch ingest ; mapping dossiers |
| 49 | Dossier de conformité vendable | hébergement, chiffrement, DPA, politique de rétention — document + features associées |
| 50 | Jurisprudence Cour de cassation v1 | pipeline #15 étendu ; anonymisation |

**Règle de lecture** : les items 1–10 sont un *reset de crédibilité et de fondations* (4–6 semaines). Les items 11–20 sont *ce qui fait signer un premier logo bancaire ou un cabinet de 20 avocats*. Le reste est de l'expansion. Si un arbitrage budgétaire s'impose : couper dans 36–50 avant de toucher à 1–20.

---

## LE MOT DE LA FIN DU COMITÉ

> **L'ex-Partner M&A** : « Je n'achète pas une IA, j'achète la certitude qu'aucune CP n'est oubliée un vendredi de closing. Construisez ça d'abord. »
>
> **Le GC** : « Le jour où votre outil m'écrit "le décret de ce matin touche trois de vos contrats", je signe pour tout le groupe. »
>
> **L'ex-Product Lead Doctrine** : « Notre fossé, c'était dix ans de corpus. Le vôtre peut être le Maroc puis l'OHADA — mais le compteur tourne. »
>
> **L'ex-ingénieur Harvey** : « Arrêtez d'améliorer le chat. Construisez des workflows dont la sortie se vérifie. Et mesurez tout : sans évals, vous naviguez au sentiment. »
>
> **Le CTO** : « Le backend tiendra 18 mois. Le front, pas 3. Réécrivez-le pendant qu'il est petit. »
>
> **Le designer** : « Un juriste paie 1 000 €/mois pour un outil qui le fait paraître impeccable. Chaque emoji, chaque alert(), chaque lien mort dit le contraire. »

**Réponse à la question obsédante — pourquoi le DJ ouvrirait Juria à 8h30 :** parce que c'est le seul écran au monde qui lui dit, en une seconde, *ce qui expire, ce qui bloque, ce qui a changé dans le droit cette nuit, et ce qu'on attend de lui aujourd'hui* — sur SES dossiers, en droit marocain, avec les sources. Tout le reste de ce rapport n'est que le chemin vers cet écran.
