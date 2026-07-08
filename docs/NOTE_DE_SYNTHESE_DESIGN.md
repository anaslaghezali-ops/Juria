# Note de synthèse — Document de conception

_Statut : proposition à valider. Rédigé le 2026-07-08._

## 0. Vision produit

> « Lis-moi ce contrat et prépare-moi une note de synthèse. Je veux comprendre
> l'essentiel en cinq minutes. »

Le livrable n'est pas un résumé : c'est un **mémo juridique transmissible**,
avec en-tête professionnel (Objet / Réf / Date / Rédacteur), sections
normées, citations ancrées dans le contrat, et un niveau de langue qu'un
collaborateur senior assumerait devant un associé.

Trois principes directeurs :

1. **Chaque affirmation est sourcée.** Pas une ligne du mémo sans lien vers le
   passage exact du contrat. C'est ce qui sépare un outil de confiance d'un
   « résumé ChatGPT ».
2. **Le temps de génération est un moment de produit.** L'utilisateur regarde
   un juriste travailler, pas un spinner.
3. **Jamais deux fois le même travail.** Document inchangé → mémo servi depuis
   la base, zéro appel IA.

---

## 1. Audit de l'existant (ce qu'on réutilise)

L'infrastructure nécessaire existe déjà à ~80 % :

| Actif existant | Rôle dans la synthèse |
|---|---|
| `document_content.extracted_text` | Texte source intégral |
| `document_chunks` (chunk_index, **page_number**, **section_title**, start_char/end_char, embedding, **chunk_version**) | **Système d'ancrage des citations** : chaque référence du mémo pointe un chunk → page + position exacte |
| `document_summaries` (map-cache par section, upsert) | Cache de l'étape MAP — déjà utilisé par le chat en mode global |
| `document_analyses` (versionné : chunk_version_at_analysis, model_used, prompt_version, tokens_used, raw_result jsonb) | **Modèle de persistance idéal** pour un artefact IA versionné |
| `document_risks`, `document_clauses` | Matière première : la synthèse **consomme** l'analyse existante au lieu de la refaire |
| `documents.content_hash` + `chunk_version` | Détection « document inchangé » → réutilisation sans IA |
| `chat-with-doc` (modes section-summary / global) + orchestration client `parallelWithLimit` | Pattern map-reduce **déjà en production** — on le muscle, on ne l'invente pas |
| `_shared/auth.ts`, `_shared/cors.ts` | Sécurité des edge functions |

Modèles LLM en place : gpt-4o-mini (map/chat), gpt-4o (analyse). On garde
cette répartition : **mini pour l'extraction (MAP), 4o pour la rédaction
(REDUCE)** — le coût est dominé par le MAP, la qualité par le REDUCE.

---

## 2. UX — où vit la fonctionnalité

### Décision : un onglet « Note de synthèse » dans `document-view.html`

`document-view.html` est la fiche du document — c'est là que vit tout ce qui
*décrit* un document. La synthèse est le deuxième artefact majeur d'un
document (après l'analyse de risques). En faire une page séparée casserait le
modèle mental « un document = une fiche ».

La fiche document devient une **fiche à onglets** :

```
┌──────────────────────────────────────────────────────────┐
│  ← Documents   SHA Fertinagro – OCP.pdf        [⟳] [💬]  │
├──────────────────────────────────────────────────────────┤
│  Vue d'ensemble   │   Note de synthèse   │   Risques     │
├──────────────────────────────────────────────────────────┤
```

**Points d'entrée** (la fonctionnalité doit se découvrir toute seule) :
1. Onglet « Note de synthèse » de la fiche document (état vide élégant avec
   CTA si jamais générée).
2. Fin d'analyse dans `analyse-contrat.html` : carte de succès enrichie d'un
   CTA secondaire « Générer la note de synthèse → » (moment de plus forte
   intention).
3. Action rapide `📝` sur les lignes de la bibliothèque `documents.html`.

### Lecture : trois zones (pattern Harvey / Notion)

```
┌────────────┬──────────────────────────────┬─────────────────┐
│ SOMMAIRE   │  MÉMO (colonne de lecture)   │  SOURCE (volet) │
│ (sticky)   │                              │  à la demande   │
│            │  NOTE DE SYNTHÈSE            │                 │
│ ● Exec.    │  Objet : …   Réf : …         │  Page 42        │
│ ○ Parties  │  Date : …    Par : Juria     │  ┌───────────┐  │
│ ○ Obligat. │  ───────────────────────     │  │ « texte   │  │
│ ○ Finances │  1. EXECUTIVE SUMMARY        │  │ exact de  │  │
│ ○ Durée    │  Le contrat organise…        │  │ la clause │  │
│ ○ Risques  │  [Art. 15.2 · p.42]  ← chip  │  │ surligné »│  │
│ ⚠ 3 vigil. │  cliquable                   │  └───────────┘  │
│ ○ Conclus. │                              │  [Ouvrir le doc]│
└────────────┴──────────────────────────────┴─────────────────┘
```

- **Sommaire sticky à gauche** : navigation instantanée dans 15–20 sections,
  scroll-spy (la section lue est surlignée), pastilles d'état (⚠ sur
  « Points de vigilance » s'il y a du critique).
- **Colonne de lecture centrale** : largeur max ~720px (confort de lecture),
  titres serif (DM Serif Display, déjà la signature visuelle de Juria), corps
  Inter. En-tête de mémo formel.
- **Citations = chips inline** `[Art. 15.2 · p. 42]`. Un clic ouvre le **volet
  source** à droite : le passage exact du contrat, surligné, avec son
  contexte, et un bouton « Ouvrir dans le document ». L'utilisateur ne quitte
  jamais sa lecture — le contrat vient à lui.
- Mobile : sommaire en menu déroulant sous le titre, volet source en
  bottom-sheet plein écran.

### Pendant la génération : « le juriste au travail »

Écran de génération dédié (remplace le contenu de l'onglet), deux zones :

**Timeline verticale à gauche** — les étapes réelles du pipeline, avec des
compteurs vivants alimentés par la vraie progression :

```
✓ Lecture du document            142 pages · 27 sections
✓ Compréhension de la structure  9 chapitres identifiés
✓ Identification des parties     3 parties · 2 groupes
● Analyse des obligations        18 / 27 sections…      ← en cours
○ Analyse des risques
○ Clauses sensibles et inhabituelles
○ Rédaction de la synthèse
○ Contrôle de cohérence
```

Chaque étape correspond à une phase réelle (voir §4) — les compteurs sont de
vraies données, pas une animation. C'est ce qui rend la scène crédible.

**Zone de rédaction à droite** — dès la phase REDUCE, l'Executive Summary
**s'écrit en streaming** sous les yeux de l'utilisateur, section après
section, avec le sommaire qui se construit au fur et à mesure. L'utilisateur
peut commencer à lire pendant que la suite se rédige.

Interruption possible, reprise gratuite (le cache MAP est persisté).

---

## 3. Contenu du mémo

Structure normée (JSON, chaque section = `{id, title, markdown, refs[], confidence}`) :

1. **Executive Summary** — 10 lignes max, autoportant
2. **Objet du contrat**
3. **Contexte** (si détectable : préambule, considérants)
4. **Parties** (+ rôles, groupes, capacité)
5. **Économie générale du contrat** *(ajout : qui apporte quoi, qui paie quoi — la « physique » du deal en 5 lignes)*
6. **Structure du document**
7. **Obligations par partie** *(tableau qui / quoi / quand / sanction)*
8. **Conditions financières**
9. **Calendrier contractuel** *(ajout : toutes les dates et délais extraits, chronologiquement — alimente potentiellement les Échéances)*
10. **Durée, renouvellement, tacite reconduction**
11. **Garanties**
12. **Responsabilités et plafonds**
13. **Cas de résiliation**
14. **Droit applicable et règlement des litiges** *(ajout : essentiel au Maroc — arbitrage CIMAC vs tribunaux, langue de procédure)*
15. **Propriété intellectuelle & confidentialité** *(ajout si matière)*
16. **Données personnelles — loi 09-08** *(ajout si matière : angle différenciant Maroc)*
17. **Clauses sensibles**
18. **Clauses inhabituelles** *(vs standards de place)*
19. **Points de vigilance** (croisés avec `document_risks` existants)
20. **Risques par criticité**
21. **Leviers de renégociation** *(avec argumentaire)*
22. **Questions ouvertes** *(zones d'ombre, annexes manquantes, renvois vides — ce qu'un senior signalerait)*
23. **Conclusion et recommandation** *(avis actionnable : signer / renégocier / bloquer)*

Sections 3, 15, 16 conditionnelles (omises si le contrat n'a pas la matière —
un bon mémo ne délaye pas). Chaque section porte un score de confiance ;
sous un seuil, bandeau discret « à faire vérifier ».

---

## 4. Architecture technique

### Pipeline hybride MAP → REDUCE hiérarchique, orchestré client, streaming SSE

Le pattern existe déjà dans le chat (split → section-summary parallèle →
global). On le professionnalise en 4 phases. **L'orchestrateur est le
navigateur** (comme aujourd'hui) : chaque appel edge reste court (< 60 s),
ce qui contourne les limites de durée des edge functions et donne
naturellement la télémétrie de progression pour la timeline.

```
PHASE 0 — PRÉPARATION (0 IA, < 1 s)
  charge : documents (hash, chunk_version), document_chunks (structure),
           dernière analyse + risques + clauses existants
  décide : cache hit total ? → servir le mémo stocké, FIN.

PHASE 1 — MAP : extraction structurée par section (gpt-4o-mini, parallèle ×4)
  découpage par structure réelle (section_title / pages des chunks,
  fallback ~12k chars avec chevauchement)
  par section → JSON : {parties, obligations[], montants[], dates[],
    durées, garanties, responsabilités, résiliation, clauses_sensibles[],
    citations[{quote, chunk_index, page}]}
  cache : document_summaries (enrichi, voir §5) — re-généré uniquement
  pour les sections dont le contenu a changé
  → timeline : « Analyse des obligations 18/27 »

PHASE 2 — REDUCE hiérarchique (gpt-4o-mini puis gpt-4o)
  si > ~25 sections : consolidation intermédiaire par lots de 10
  (fusion des extraits JSON, dédoublonnage des obligations/dates)
  → un « dossier d'instruction » compact (~15-30k tokens max, borné
  quelle que soit la taille du contrat — c'est ce qui rend l'approche
  scalable à plusieurs centaines de pages)

PHASE 3 — RÉDACTION (gpt-4o, STREAMING SSE)
  3 appels groupés par affinité (au lieu de 23 appels ou 1 seul) :
    A. sections factuelles (objet → durée)      | streamées
    B. sections d'analyse (garanties → risques) | streamées
    C. sections d'opinion (renégociation → conclusion) + Executive
       Summary rédigé EN DERNIER (il synthétise le mémo, pas le contrat)
  entrée : dossier d'instruction + risques/clauses de l'analyse existante
  sortie : markdown balisé section par section, refs inline [[chunk:idx]]

PHASE 4 — PERSISTANCE (0 IA)
  validation des refs (chaque [[chunk:idx]] existe → sinon ref dégradée
  en « non localisé », jamais de faux ancrage)
  insert document_analyses (kind='synthesis', raw_result = mémo JSON)
  update documents.executive_summary
```

**Nouvelle edge function : `generate-synthesis`** (réutilise `_shared/`),
3 modes : `extract` (MAP, JSON), `consolidate` (REDUCE intermédiaire),
`compose` (rédaction, **SSE streaming** — première utilisation du streaming
dans Juria, motif : c'est ici qu'il crée le plus de valeur perçue).

**Nouveau service : `services/synthesis-service.js`** (étend `BaseService`,
conventions actuelles) : orchestration des phases, gestion du cache, émission
des événements de progression consommés par la timeline UI.

### Coût & robustesse

- Contrat 150 pages ≈ 30 sections : MAP ~30 appels mini (~150k tokens in),
  REDUCE 3-4 appels 4o (~40k in / 8k out). Ordre de grandeur : **0,15–0,35 $
  par génération**, MAP amorti à vie par le cache.
- Chaque appel MAP est indépendant → échec isolé = retry ciblé, jamais de
  régénération totale. La progression est persistée (cache) : un refresh en
  pleine génération reprend où on en était.

---

## 5. Base de données — évolutions minimales (2 ALTER, 0 nouvelle table)

Conformément au principe « enrichir plutôt que créer » :

```sql
-- 1. La synthèse est un run d'analyse d'un genre différent.
--    document_analyses a déjà TOUT : versioning, chunk_version_at_analysis,
--    model_used, prompt_version, tokens_used, duration, raw_result jsonb.
ALTER TABLE document_analyses
  ADD COLUMN kind text NOT NULL DEFAULT 'audit'
  CHECK (kind IN ('audit', 'synthesis'));
CREATE INDEX idx_analyses_doc_kind
  ON document_analyses (document_id, kind, created_at DESC);
-- Les colonnes de comptage restent à 0 pour kind='synthesis' (déjà NOT NULL
-- DEFAULT 0). documents.latest_analysis_id continue de pointer l'audit.

-- 2. Le cache MAP doit être invalidable par version de document.
ALTER TABLE document_summaries
  ADD COLUMN chunk_version integer NOT NULL DEFAULT 1,
  ADD COLUMN extract jsonb,           -- extraction structurée (remplace à terme summary texte)
  ADD COLUMN organization_id uuid REFERENCES organizations(id);
-- nouvelle clé de conflit : (document_id, chunk_version, section_index)
```

Ce que ça achète :
- **Versioning** : chaque génération = une ligne `kind='synthesis'` ; l'UI
  liste les versions (v3 · 8 juil. · gpt-4o · 12 400 tokens).
- **Réutilisation sans IA** : dernière synthèse où
  `chunk_version_at_analysis = documents.chunk_version` → servie telle
  quelle.
- **Régénération** : bouton actif seulement si le document a changé ou sur
  demande explicite (confirmation si identique : « le document n'a pas
  changé, régénérer quand même ? »).

Au passage, l'ajout d'`organization_id` sur `document_summaries` permettra
d'aligner sa politique RLS sur le modèle org (aujourd'hui elle passe par une
sous-requête sur documents — fonctionnel mais hétérogène).

---

## 6. Export

| Format | Approche | Justification |
|---|---|---|
| **PDF** | CSS print dédié + `window.print()` | Pattern déjà utilisé 2× dans Juria (rapports analyse/comparaison) ; mise en page mémo (marges, en-tête/pied « Juria · Confidentiel », pagination) |
| **DOCX** | Génération client depuis le JSON via lib légère (docx.js) | Les juristes retravaillent dans Word — c'est l'export le plus important pour la cible |
| **Copier** | Clipboard API, double payload text/plain + text/html | Collage propre dans Word/Gmail |
| **Impression** | = chemin PDF | |

L'export part du **JSON structuré**, pas du DOM — fidélité garantie et les
chips de citation deviennent des notes de bas de page `(Art. 15.2, p. 42)`.

---

## 7. Découpage d'implémentation proposé

1. **Socle** : migration SQL + `synthesis-service.js` + edge `generate-synthesis` (modes extract/consolidate) — testable en console
2. **Rédaction streaming** : mode compose SSE + assemblage + persistance
3. **UI lecture** : onglets document-view, sommaire, colonne mémo, volet source
4. **UI génération** : timeline vivante + streaming visible
5. **Versions & exports** : sélecteur de versions, PDF/DOCX/copier
6. **Points d'entrée** : CTA analyse-contrat + action documents.html

Chaque jalon est livrable et testable indépendamment ; rien ne touche aux
flux existants avant le jalon 6 (zéro risque de régression).

---

## 8. Questions tranchées (et pourquoi)

| Question | Décision | Argument |
|---|---|---|
| Nouvel onglet / nouvelle page ? | Onglet dans document-view | La synthèse est un attribut du document ; garde le modèle mental « fiche » |
| Auto après analyse / à la demande ? | **À la demande**, CTA proéminent post-analyse | Coût maîtrisé, intention utilisateur explicite, le moment post-analyse capte 80 % des cas |
| Un seul prompt géant ? | Non — map-reduce hiérarchique | Scalabilité aux centaines de pages, coût borné, citations fiables (chaque quote vient d'une section précise) |
| Orchestration serveur ou client ? | Client (pattern existant) | Limites de durée des edge functions ; télémétrie de progression gratuite ; cohérent avec le chat actuel |
| Nouvelle table synthèses ? | Non — `document_analyses.kind` | Tout le versioning existe déjà ; une table de plus = duplication du modèle |
| LLM | mini (MAP) + 4o (REDUCE) | Coût dominé par le volume lu, qualité dominée par la rédaction |
