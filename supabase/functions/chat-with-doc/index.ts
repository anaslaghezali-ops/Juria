import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { authenticateRequest, errorResponse } from "../_shared/auth.ts";
import { checkOrgQuota, getOrgIdForUser, logQuotaUsage } from "../_shared/quota-utils.ts";

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

async function callGPT(messages: object[], maxTokens = 1024, temperature = 0.1, topP = 0.1): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
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
      }),
      signal: controller.signal,
    })

    const data = await response.json()
    if (!response.ok) {
      const errorMsg = data.error?.message || 'OpenAI API error';
      throw new Error(`OpenAI error (${response.status}): ${errorMsg}`);
    }
    return data.choices[0].message.content
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  // Handle CORS preflight
  const preflightResponse = handleCorsPreFlight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // ✅ AUTHENTICATION REQUIRED
    const { userId } = await authenticateRequest(req);

    const body = await req.json()
    const { mode, question, context } = body

    // ✅ BASIC INPUT VALIDATION
    if (!mode || typeof mode !== 'string') {
      return errorResponse(400, 'mode is required', corsHeaders);
    }
    // section-summary est appelé sans question (le front n'envoie que le
    // texte de la section) — exiger question ici cassait l'analyse globale.
    if (mode !== 'section-summary' && (!question || typeof question !== 'string')) {
      return errorResponse(400, 'question is required', corsHeaders);
    }
    if (question && (typeof question !== 'string' || question.length > 2000)) {
      return errorResponse(400, 'question must be < 2000 chars', corsHeaders);
    }
    if (context && typeof context !== 'string') {
      return errorResponse(400, 'context must be a string', corsHeaders);
    }
    if (context && context.length > 50000) {
      return errorResponse(400, 'context is too large (max 50KB)', corsHeaders);
    }

    // Historique de conversation optionnel (mode rag) : borné et assaini.
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-6)
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }))

    // Quota v2 : les réponses aux questions sur document (rag) et l'analyse
    // globale consomment des crédits "chat". Les modes techniques internes
    // (classifier, section-summary — étape d'indexation mise en cache) restent
    // non facturés. Un compte sans organisation n'est pas bloqué.
    const isBilled = mode !== 'classifier' && mode !== 'section-summary'
    let orgId: string | null = null
    if (isBilled) {
      try {
        orgId = await getOrgIdForUser(userId)
        const quotaCheck = await checkOrgQuota(orgId, 'chat', 1)
        if (!quotaCheck.allowed) {
          return new Response(JSON.stringify({
            error: quotaCheck.reason || 'Quota organisation atteint',
            code: 'QUOTA_EXCEEDED',
            remaining_credits: quotaCheck.remaining_credits,
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
      } catch (_e) {
        orgId = null // pas d'organisation active : on ne bloque pas
      }
    }

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
          content: `Tu es Juria, assistant juridique specialise en droit marocain. Tu reponds a des questions sur un document a partir des passages fournis.

REGLES :
1. Commence par la reponse CONCRETE. Si la question porte sur une date, un montant, un delai ou un nom, donne la VALEUR EXACTE trouvee dans les passages (ex. « le 30 septembre 2025 »), jamais une paraphrase du mecanisme contractuel a la place de la valeur.
2. Passe TOUS les passages en revue avant de repondre : la reponse est parfois repartie entre plusieurs passages (ex. un mecanisme de notification dans l'un ET une date butoir dans un autre).
3. Si plusieurs elements repondent a la question (date prevue, date butoir, penalites de retard...), mentionne-les tous.
4. Justifie ensuite avec l'extrait exact entre guillemets (et la page si indiquee dans le passage).
5. Si l'information ne figure pas dans les passages, dis-le clairement.
Reponds en francais.`
        },
        ...history,
        {
          role: 'user',
          content: 'Passages du document :\n' + context + '\n\nQuestion : ' + question
        }
      ], 1024, 0.2, 0.2)
    }

    if (isBilled && orgId) {
      logQuotaUsage(orgId, 'chat', 1).catch((e) =>
        console.warn('[chat-with-doc] Quota log failed:', e)
      )
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
