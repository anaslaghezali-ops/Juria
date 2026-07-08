# Audit UX Juria — qualité perçue

_Head of Product review, 2026-07-08. Captures desktop 1440×900 + audit de code sur les 10 écrans._

## Verdict global

Juria a un **fond excellent** (analyse, synthèse, citations ancrées) enveloppé dans
une **forme de dashboard admin générique**. Un Directeur Juridique qui paie ne voit
pas le pipeline — il voit des emojis dans la navigation, huit compteurs à zéro
multicolores et trois largeurs de sidebar différentes. La qualité perçue se joue
là, pas dans les fonctionnalités.

## Le chiffre qui résume tout

| Incohérence mesurée | Valeurs trouvées dans le code |
|---|---|
| Largeur de sidebar | **240 / 256 / 260 px** selon la page |
| Hauteur de topbar | **52 / 54 / 56 px** |
| Rayon des cartes | **10 / 12 / 14 / 16 px** (79 occurrences) |
| Taille de police racine | 15 px… et 16 px sur une page |
| Langage d'icônes | **12 emojis** (documents, chat, admin) vs **SVG** (document-view) |
| Design tokens | `:root` **redéfini dans 10 fichiers** — aucun socle commun |

Chaque page a été construite comme une île. C'est le péché originel : tout le
reste en découle.

---

## Critique écran par écran

### documents.html (l'espace de travail) — la pire première impression
- **Mauvais** : le mur de 8 KPI à bordure gauche multicolore (indigo, rouge,
  orange, vert, bleu…) est LA signature du "dashboard Bootstrap". Pire : sur un
  compte réel jeune, ils affichent presque tous **0** — huit zéros encadrés de
  couleurs vives, c'est un tableau de bord qui crie "vide".
- **Mauvais** : navigation avec emojis (📊🏢📁📄⚠️📅🕐✅💬📚🔍⚙️) — aucun logiciel
  premium n'utilise d'emojis système comme iconographie : rendu inégal selon
  l'OS, poids visuel incontrôlable, aucune cohérence de trait.
- **Mauvais** : pastilles de compteur affichant "0" ou "—" dans la nav — un badge
  qui dit "rien" est du bruit pur.
- **Moyen** : "Dashboard" écrit deux fois (topbar + H1) à 60 px d'écart.
- **Moyen** : les 3 cartes "Risques élevés / Tâches / Contreparties" vides avec
  chacune un gros bouton bordé pleine largeur — trois fois le même meuble vide.
- **Bruit** : la tuile "Répartition des risques" en pavés rouge/jaune/vert remplis
  affichant 0/0/0.

### document-view.html (le cœur du produit)
- **Bon** : structure globale saine, onglets récents propres, mémo de synthèse
  déjà au niveau.
- **Mauvais** : chargement = spinner nu au centre d'un écran blanc — l'attente la
  plus fréquente du produit n'est pas travaillée. Un logiciel premium montre le
  squelette de ce qui arrive.
- **Moyen** : les 3 blocs de score (fond gris plein) pèsent plus lourd que le
  titre du document ; hiérarchie inversée.
- **Moyen** : cartes empilées de même poids visuel — Résumé, Risques, Clauses,
  Historique ont exactement la même importance apparente ; aucun état hover ;
  aucune transition entre onglets.
- **Incohérent** : la sidebar utilise des SVG… seule page à le faire.

### chat.html
- **Bon** : écran d'accueil (suggestion chips, hero centré) — le meilleur écran
  du produit aujourd'hui.
- **Moyen** : "Chargement…" figé en haut à droite ; colonne discussions vide sans
  état travaillé ; le compteur "0 / 600" affiché en permanence est du bruit
  tant qu'on n'approche pas de la limite.
- **Incohérent** : emojis dans la nav ici aussi.

### base-juridique.html
- **Moyen** : cartes de codes avec emojis géants (🕮⚖️👷🛡️) centrés — rendu
  "clipart". Le contenu (5 000 articles) mérite une présentation de bibliothèque
  professionnelle.
- **Bon** : la recherche à filtres par code est claire.

### dashboard.html (l'accueil)
- **Bon** : hiérarchie propre, cartes d'action lisibles.
- **Moyen** : redondance quasi totale avec la sidebar de documents.html — cette
  page est un menu. Acceptable en attendant, mais c'est un écran de plus à
  maintenir pour zéro information.
- **Détail** : émoji 👋 dans le titre ; icônes emoji des cartes inégales.

### administration.html
- **Correct** depuis la passe mobile. Mêmes problèmes de fond : emojis, boutons
  d'action ⊗ ↻ 🗑 cryptiques, tokens locaux.

### Transversal
- **Modales** : apparition sèche (display:flex), aucune animation, comportements
  divergents entre pages.
- **Tableaux** : styles d'en-tête et paddings différents entre documents.html et
  administration.html.
- **Boutons** : 8 variantes de padding/hauteur pour le même rôle.
- **Focus clavier** : aucun `:focus-visible` travaillé — inacceptable pour un
  produit vendu à des banques (accessibilité = case d'appel d'offres).
- **Animations** : quasi inexistantes, et quand elles existent (toast), non
  reprises ailleurs.

---

## Priorisation (impact perçu × effort)

| P | Chantier | Impact | Effort |
|---|---|---|---|
| **P0** | **Design system unique** (`assets/juria-ui.css`) : tokens, cartes, boutons, tables, modales animées, focus-visible, skeletons, empty states — chargé par toutes les pages, il écrase les divergences locales | Énorme — c'est lui qui "répare" 10 écrans d'un coup | Moyen |
| **P0** | **Icônes SVG partout** (documents, chat, admin) — mort aux emojis de nav | Énorme (marqueur n°1 du "cheap") | Faible |
| **P0** | **De-bootstrapiser le dashboard interne** : KPI sans arc-en-ciel, zéros apaisés, pastilles "0" masquées | Fort | Faible |
| **P0** | **document-view : skeleton loader + transitions d'onglets + hiérarchie du header** | Fort (cœur du produit) | Moyen |
| **P1** | Empty states élégants partout (illustration discrète + une action) | Fort | Moyen |
| **P1** | Unifier les modales (comportement + animation) et les tableaux | Moyen | Moyen |
| **P2** | Fusion dashboard.html ↔ documents.html (un seul point d'entrée) | Moyen | Fort |
| **P2** | **Panneau contextuel de document-view** (sélection d'une clause → analyse/risques/tâches/IA contextualisés, PDF au centre) : c'est une **évolution structurelle**, pas un polissage — document-view n'affiche pas le document aujourd'hui. À concevoir comme un jalon dédié après ce chantier | Énorme | Très fort |

**Décision d'exécution : P0 intégral maintenant.** Le P2 "panneau contextuel
Harvey-like" est explicitement reporté : le brief interdit les nouvelles
fonctionnalités avant l'assainissement, et afficher le PDF + sélection de
clauses EST une fonctionnalité nouvelle. Elle méritera son propre design doc.

## Principes du design system appliqué

- **Un seul socle** : `assets/juria-ui.css`, chargé après les styles locaux de
  chaque page (le dernier gagne à spécificité égale) — les pages convergent sans
  réécrire 10 fichiers.
- Rayon unique **14 px** (cartes) / **9 px** (contrôles), topbar **56 px**,
  sidebar **260 px**.
- **Une seule couleur d'accent** (indigo) ; le rouge/orange/vert réservés aux
  sémantiques de risque, jamais à la décoration.
- Boutons : 2 tailles (36 / 40 px), transitions 0.15 s, `:focus-visible` ring.
- Motion discrète : fade-up 0.25 s sur les panneaux, hover-lift 1 px sur les
  cartes interactives, shimmer sur les skeletons, `prefers-reduced-motion`
  respecté.
