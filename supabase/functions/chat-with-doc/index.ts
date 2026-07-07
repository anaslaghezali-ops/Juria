const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

async function callGPT(messages: object[], maxTokens = 1024, temperature = 0.1, topP = 0.1): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      messages
    })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message || 'Erreur OpenAI')
  return data.choices[0].message.content
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { mode, question, context } = body
    let answer = ''

    // ── MODE CLASSIFIER ──────────────────────────────────────────
    if (mode === 'classifier') {
      answer = await callGPT([
        {
          role: 'system',
          content: `Tu es un classifieur. Reponds UNIQUEMENT par le mot GLOBAL ou RAG.

GLOBAL si la question demande :
- une analyse complete du document
- un resume ou synthese
- les risques, obligations, engagements d une partie
- une evaluation juridique
- les clauses importantes ou desequilibrees
- un avis juridique

RAG si la question demande :
- une information precise (date, montant, nom, article)
- le contenu d une clause specifique
- une definition ou reference precise`
        },
        { role: 'user', content: question }
      ], 5, 0, 0.1)
      answer = answer.trim().toUpperCase().includes('GLOBAL') ? 'GLOBAL' : 'RAG'

    // ── MODE SECTION-SUMMARY ─────────────────────────────────────
    } else if (mode === 'section-summary') {
      answer = await callGPT([
        {
          role: 'system',
          content: `Tu es un juriste marocain expert en droit des affaires.
Analyse cette section juridique et extrait chaque clause importante.

Pour chaque clause, utilise ce format EXACT :

[TYPE: XXX] [Ref: Y] "extrait textuel exact de 30 a 80 mots" → implication juridique

Types a utiliser (choisis le plus precis) :
- EVENT_OF_DEFAULT : evenement de defaut, manquement, breach
- FUNDING : financement, capital, contribution financiere
- DEADLOCK : blocage decisonnel, impasse, desaccord entre actionnaires
- TERMINATION : resiliation, fin de contrat, cessation
- GOVERNANCE : droits de vote, conseil d administration, nominations, approbations
- APPROVAL : autorisations, consentements, conditions prealables
- TRANSFER : cession d actions, transfert, droit de preemption
- CHANGE_OF_CONTROL : changement de controle, acquisition
- ARBITRATION : arbitrage, resolution des litiges, mediation
- CONFIDENTIALITY : confidentialite, non-divulgation
- COMPLIANCE : conformite, lois applicables, sanctions
- FINANCIAL_REPORTING : reporting financier, comptes, audit
- SUPPLY : fourniture, approvisionnement, livraison
- IP : propriete intellectuelle, licence, brevet
- OTHER : tout autre element important non classe ci-dessus

IMPORTANT :
- COPIE l extrait textuel exact entre guillemets (30-80 mots)
- Ne generalise pas
- Ne commente pas ce qui n est pas dans le texte
- Une ligne par clause importante`
        },
        { role: 'user', content: context }
      ], 700, 0.1, 0.1)

    // ── MODE GLOBAL ───────────────────────────────────────────────
    } else if (mode === 'global') {
      answer = await callGPT([
        {
          role: 'system',
          content: `Tu es un juriste expert en droit marocain des affaires.

Le document t est fourni sous forme de resumes structures avec des clauses classees par TYPE.

INSTRUCTIONS STRICTES :

ETAPE 1 — INVENTAIRE PAR TYPE
Pour chaque TYPE present dans le document, liste TOUTES les clauses trouvees.

ETAPE 2 — SCORING ET FUSION PAR TYPE
Pour chaque clause d un TYPE, attribue un score de criticite selon cet impact sur la partie visee :
- Score 5 : suspension de droits, perte de controle, resiliation immediate
- Score 4 : obligation de financement, penalite financiere significative, perte de position
- Score 3 : blocage operationnel, approbation bloquante, deadlock
- Score 2 : obligation de reporting, restriction de transfert
- Score 1 : obligation administrative, notification, conformite generale

Puis pour chaque TYPE :
- Si plusieurs clauses ont un score >= 3 : FUSIONNE-LES en un seul risque enrichi
  Format fusion : liste toutes les references sous "Clauses :", cite l extrait de la plus critique
- Si une seule clause est materielle : utilise-la directement
- Si aucune clause n atteint le score 3 : ignore ce TYPE (pas de risque a remonter)

ETAPE 3 — FILTRE DE MATERIALITE
Ne remonter un TYPE que s il cree AU MOINS UN des impacts suivants pour la partie visee :
- Perte financiere (penalite, indemnite, manque a gagner)
- Perte de controle (droits de vote suspendus, decisions imposees)
- Suspension de droits (vote, nomination, distribution)
- Responsabilite juridique (mise en cause, arbitrage, sanction)
- Resiliation d un accord (fin du contrat, perte de position)
- Blocage operationnel (impossibilite d agir, paralysie)
- Dependance critique (obligation exclusive, fournisseur unique)

NE PAS remonter si uniquement :
- Obligation administrative normale sans sanction explicite
- Confidentialite sans sanction explicite
- Cooperation generale sans consequence precise

ETAPE 4 — FILTRAGE PAR PARTIE VISEE
Si la question vise une partie specifique (OCP, Al Dahra, bailleur...) :
- Inclus UNIQUEMENT les risques affectant cette partie
- Ignore les risques supportes exclusivement par les autres parties

ETAPE 5 — GENERATION DANS L ORDRE FIXE
Traite les types dans cet ordre INVARIABLE :
EVENT_OF_DEFAULT → FUNDING → TERMINATION → DEADLOCK → CHANGE_OF_CONTROL → GOVERNANCE → APPROVAL → TRANSFER → ARBITRATION → SUPPLY → COMPLIANCE → FINANCIAL_REPORTING → IP → CONFIDENTIALITY → OTHER

Maximum 10 risques. Aucun minimum.
Tri final : ELEVE d abord, puis MOYEN, puis FAIBLE.

FORMAT pour risque avec fusion de clauses :
**[Niveau : ELEVE / MOYEN / FAIBLE]** [TYPE] Titre du risque
- Clauses : ref1, ref2, ref3 (toutes les references fusionnees)
- Extrait principal : "citation de la clause la plus critique (30-80 mots)"
- Interpretation : analyse combinee des clauses
- Consequence : impact concret cumule
- Recommandation : action specifique

FORMAT pour risque avec clause unique :
**[Niveau : ELEVE / MOYEN / FAIBLE]** [TYPE] Titre du risque
- Clause/Article : reference exacte
- Extrait : "citation exacte (30-80 mots)"
- Interpretation : ce que cette clause signifie pour la partie visee
- Consequence : impact concret
- Recommandation : action specifique

SCORING DE CRITICITE :
- ELEVE : EVENT_OF_DEFAULT, FUNDING, TERMINATION, CHANGE_OF_CONTROL
- MOYEN : DEADLOCK, GOVERNANCE, APPROVAL, TRANSFER, ARBITRATION, SUPPLY
- FAIBLE : COMPLIANCE, FINANCIAL_REPORTING, IP, CONFIDENTIALITY, OTHER

FORMAT OBLIGATOIRE pour chaque risque :
**[Niveau : ELEVE / MOYEN / FAIBLE]** [TYPE] Titre du risque
- Clause/Article : reference exacte
- Extrait : "citation exacte entre guillemets"
- Interpretation : ce que cette clause signifie pour la partie visee
- Consequence : impact concret
- Recommandation : action specifique

Reponds en francais.`
        },
        {
          role: 'user',
          content: 'Document (clauses classees par type) :\n' + context + '\n\nQuestion : ' + question
        }
      ], 4000, 0.1, 0.1)

    // ── MODE RAG (defaut) ─────────────────────────────────────────
    } else {
      answer = await callGPT([
        {
          role: 'system',
          content: `Tu es un assistant juridique specialise en droit marocain.
Reponds uniquement sur la base des passages fournis.
Cite l extrait exact qui justifie ta reponse entre guillemets.
Si l information n y est pas, dis-le clairement.`
        },
        {
          role: 'user',
          content: 'Passages du document :\n' + context + '\n\nQuestion : ' + question
        }
      ], 1024, 0.2, 0.2)
    }

    return new Response(
      JSON.stringify({ answer }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
