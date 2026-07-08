# Système de Quota Global par Organisation (v2)

## Vue d'ensemble
Remplacer le système de quotas par plan (trial: 3, essential: 20) par un système centralisé de crédits.
Chaque organisation dispose d'un budget mensuel partagé entre tous ses utilisateurs.

---

## 1. Quota global par org

- Colonne `monthly_quota` dans `organizations` = budget total pour l'org ce mois-ci
- Ce quota paie pour :
  - Synthèses (extract + compose)
  - Analyses de risques
  - Comparaisons de documents
  - Chats avec l'IA

---

## 2. Système de "crédits" ou "coûts"

Chaque opération consomme un nombre de crédits :
- **Synthèse** = 1 crédit (ou 2, selon complexité)
- **Analyse de risque** = 0.5 crédit
- **Comparaison doc** = 0.5 crédit
- **Chat** = 0.1 crédit par message (ou à la minute/token)

Implémentation :
- Table `operation_costs` : `operation_type, base_cost, description`
- Superadmin peut ajuster les coûts unitaires par type

---

## 3. Comptage centralisé

Deux approches possibles :

### Option A : Table dédiée
```sql
CREATE TABLE organization_usage (
  id bigint primary key,
  org_id bigint references organizations(id),
  month date,
  operation_type text,  -- 'synthesis', 'risk_analysis', 'doc_comparison', 'chat'
  count int,            -- nombre d'opérations
  total_cost float,     -- count × unit_cost
  created_at timestamp
);
```

### Option B : Colonne sur logs existants
- Ajouter `cost_credit` sur `document_analyses`, tables de chat, etc.
- Query : agrégation par org + month

Fonction centralisée :
```ts
getRemainingQuota(org_id: string): Promise<{
  total_quota: number
  used_credits: number
  remaining: number
  month: string
  breakdown: Record<string, number>  // synthèses: 5, risques: 2.5, etc.
}>
```

---

## 4. Enforcement partout

Points de contrôle :

1. **Avant synthèse** → appel `getRemainingQuota()` dans `generate-synthesis`
2. **Avant analyse de risque** → RAS (edge function à checker)
3. **Avant comparaison doc** → RAS (edge function à checker)
4. **Avant chat** → RAS (ou par message si modèle streaming)

Si `remaining <= 0` :
- Bloquer l'opération
- Retourner erreur 429 QUOTA_EXCEEDED
- Message UI : "Quota organisation atteint pour ce mois. Upgrade ou attendre mois prochain."
- Lien vers upgrade/facturation

---

## 5. Superadmin dashboard

Nouvelle page : `/administration/superadmin`

Sections :
- **Vue globale** : liste orgs, quota utilisé vs max, % de remplissage
- **Breakdown par type** : synthèses: 45%, analyses: 30%, comparaisons: 20%, chats: 5%
- **Historique mensuel** : tendances sur 12 mois
- **Gestion** :
  - Formulaire pour augmenter quota d'une org
  - Ajuster les coûts unitaires (`operation_costs`)
  - Voir l'utilisation détaillée par org (qui a généré quoi)

---

## Migration de l'existant

1. Désactiver l'ancien système (quotas par plan)
2. Initialiser `monthly_quota` pour orgs existantes basé sur leur plan actuel
3. Remplir `operation_costs` avec les coûts de base
4. Enregistrer les synthèses existantes comme crédits consumés ce mois

---

## Prochaines étapes

- [ ] Définir précisément les coûts (synthèse = 1? 2? basé sur longueur doc?)
- [ ] Choisir entre table dédiée ou colonnes ajoutées
- [ ] Créer migrations Supabase
- [ ] Implémenter `getRemainingQuota()`
- [ ] Ajouter checks dans chaque edge function (synthesis, risk, comparison, chat)
- [ ] Construire superadmin dashboard
- [ ] Tester avec clients réels
