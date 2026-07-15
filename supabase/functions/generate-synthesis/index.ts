import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { authenticateRequest, errorResponse } from "../_shared/auth.ts";
import { checkOrgQuota, logQuotaUsage, getOrgIdForUser } from "../_shared/quota-utils.ts";

/**
 * JURIA — generate-synthesis
 *
 * Moteur IA de la note de synthèse (cf. docs/NOTE_DE_SYNTHESE_DESIGN.md).
 * Trois modes, orchestrés par le client (services/synthesis-service.js) :
 *
 *   - extract     (MAP)    : une section du contrat → extraction JSON
 *                            structurée. gpt-4o-mini, sortie json_object.
 *   - consolidate (REDUCE) : plusieurs extraits JSON → un extrait fusionné
 *                            et dédoublonné. gpt-4o-mini, json_object.
 *   - compose     (WRITE)  : dossier d'instruction → rédaction du mémo,
 *                            streamée en SSE. gpt-4o.
 *
 * Les citations circulent sous forme d'IDs opaques [[q:ID]] : le modèle ne
 * manipule jamais d'offsets, l'ancrage est résolu de façon déterministe
 * côté client (recherche du verbatim dans le texte source).
 */

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// ── Quotas système v2 : global par organisation + crédits ──────────────────
// Chaque org a un monthly_quota (en crédits).
// Chaque opération consomme un nombre de crédits (cf. operation_costs).
// -1 = illimité. Protection serveur, non contournable par client.
// checkOrgQuota / logQuotaUsage / getOrgIdForUser : cf. _shared/quota-utils.ts

// ── Appel OpenAI non-streamé ─────────────────────────────────────────────
async function callGPT(
  model: string,
  messages: object[],
  opts: { maxTokens?: number; temperature?: number; json?: boolean } = {},
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 2000,
        temperature: opts.temperature ?? 0.1,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
      signal: controller.signal,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`OpenAI (${response.status}): ${data.error?.message || "erreur"}`);
    }
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Appel OpenAI streamé → SSE passthrough ───────────────────────────────
async function streamGPT(
  model: string,
  messages: object[],
  maxTokens: number,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      stream: true,
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const err = await upstream.json().catch(() => ({}));
    throw new Error(`OpenAI (${upstream.status}): ${err.error?.message || "erreur stream"}`);
  }

  // Re-émission en SSE simplifié : data: {"delta":"..."} … data: [DONE]
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
              }
            } catch { /* fragment incomplet : ignoré */ }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// ── Prompts ──────────────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `Tu es un collaborateur senior d'un cabinet d'avocats marocain.
Tu instruis un dossier : tu lis une SECTION d'un contrat et tu en extrais la matière juridique, de façon exhaustive et factuelle.

Réponds UNIQUEMENT en JSON valide avec cette structure (omets les clés sans matière, tableaux vides autorisés) :

{
  "resume": "2-3 phrases factuelles sur ce que couvre cette section",
  "parties": [{"nom": "", "role": "", "details": ""}],
  "objet": "objet du contrat si cette section le définit, sinon omets",
  "obligations": [{"partie": "qui est obligé", "texte": "quoi", "echeance": "quand/délai ou null", "sanction": "conséquence du manquement ou null", "article": "réf. article/clause si mentionnée ou null", "quote": "verbatim exact 15-60 mots"}],
  "montants": [{"objet": "", "montant": "", "devise": "", "article": null, "quote": ""}],
  "taux_interet": {"type": "fixe ou variable", "taux": "ex: 5,70% HT l'an", "base": "base de calcul, ex: 360 jours", "interets_retard": "majoration en cas de retard, ex: taux + 2%", "article": null, "quote": ""},
  "remboursement": [{"modalite": "amortissement / différé / in fine / ballon / anticipé", "echeancier": "nombre d'échéances, périodicité, différé, ballon…", "montant": "", "article": null, "quote": ""}],
  "dates": [{"evenement": "", "date_ou_delai": "", "article": null, "quote": ""}],
  "duree": {"texte": "durée/renouvellement/tacite reconduction", "article": null, "quote": ""},
  "garanties": [{"type": "", "portee": "", "article": null, "quote": ""}],
  "responsabilites": [{"regime": "", "plafond": "", "exclusions": "", "article": null, "quote": ""}],
  "resiliation": [{"cas": "", "preavis": "", "consequences": "", "article": null, "quote": ""}],
  "droit_applicable": {"loi": "", "juridiction": "", "arbitrage": "", "langue": "", "article": null, "quote": ""},
  "pi_confidentialite": [{"sujet": "", "regime": "", "article": null, "quote": ""}],
  "donnees_personnelles": [{"sujet": "", "regime": "", "article": null, "quote": ""}],
  "questions_ouvertes": ["zone d'ombre, renvoi vide, annexe manquante…"]
}

RÈGLES IMPÉRATIVES :
- "quote" = COPIE EXACTE du texte source (15-60 mots), jamais reformulée. C'est une exigence absolue : ces verbatims servent à ancrer les citations dans le document.
- N'invente RIEN. Ce qui n'est pas dans la section n'existe pas.
- "article" : uniquement si la référence (Article 5, Clause 12.3…) figure dans le texte.
- CONTRATS DE FINANCEMENT (crédit, prêt, ouverture de crédit) : si la section fixe le TAUX D'INTÉRÊT (pourcentage, type fixe/variable, base 360/365), les INTÉRÊTS DE RETARD, ou l'ÉCHÉANCIER DE REMBOURSEMENT (nombre d'échéances, périodicité, période de différé, amortissement, échéance ballon/in fine, remboursement anticipé), capture-les IMPÉRATIVEMENT dans "taux_interet" et "remboursement". Ce sont les données CENTRALES d'un financement : ne les laisse JAMAIS tomber dans "montants" ni les omettre.
- Style télégraphique, factuel, STRICTEMENT DESCRIPTIF : aucune opinion, aucune qualification de risque.
- TERMINOLOGIE DES PARTIES : désigne chaque partie par le TERME DÉFINI du contrat (ex : « le Prêteur », « l'Emprunteur », « l'Agent »), tel qu'écrit. N'utilise JAMAIS de synonyme ou de paraphrase de ton cru. Si une table des parties t'est fournie, respecte-la à la lettre ; une même entité peut agir en plusieurs qualités (Prêteur ET Agent) — ne fusionne jamais des qualités distinctes.`;

// Étape 0 : « qui est qui » — lue une seule fois sur l'ouverture du contrat
// (comparution + article Définitions), puis injectée à TOUS les étages pour
// que « Banque X », « le Prêteur » et autres désignations restent cohérents.
const PARTIES_TABLE_SYSTEM = `Tu es un collaborateur senior d'un cabinet d'avocats marocain.
On te donne le DÉBUT d'un contrat (comparution des parties + définitions). Construis la table des parties.

Réponds UNIQUEMENT en JSON valide :
{"parties": [{"terme_defini": "terme exact utilisé dans le contrat (ex: le Prêteur, l'Emprunteur, l'Agent, les Garants)", "entite": "dénomination légale telle qu'écrite (ex: Banque X S.A.)", "qualite": "rôle en un mot ou deux (prêteur, emprunteur, agent du crédit, arrangeur, garant…)"}]}

RÈGLES :
- Une entrée PAR TERME DÉFINI : si Banque X est à la fois « Prêteur » et « Agent », deux entrées (même entite, qualites différentes).
- Inclus les termes collectifs (« les Prêteurs », « les Parties ») s'ils sont définis.
- "entite" et "terme_defini" recopiés tels qu'écrits dans le texte, sans reformulation.
- N'invente rien : uniquement ce qui figure dans l'extrait fourni. Tableau vide si aucune partie identifiable.`;

// Bloc de prompt partagé : injecté dans extract / consolidate / compose dès
// que le client fournit la table.
function partiesClause(partiesTable: unknown): string {
  if (!Array.isArray(partiesTable) || partiesTable.length === 0) return "";
  const rows = partiesTable.slice(0, 24).map((p: any) =>
    `- « ${p.terme_defini} » = ${p.entite}${p.qualite ? ` (${p.qualite})` : ""}`).join("\n");
  return `\n\nTABLE DES PARTIES (termes définis du contrat) :\n${rows}\nRÈGLE ABSOLUE DE TERMINOLOGIE : désigne TOUJOURS chaque partie par son terme défini EXACT ci-dessus — jamais de synonyme, jamais de paraphrase (pas d'« émetteur de crédit » si le contrat dit « le Prêteur »). Une même entité peut cumuler plusieurs qualités : ne fusionne jamais deux termes définis distincts.`;
}

const CONSOLIDATE_SYSTEM = `Tu es un collaborateur senior. On te donne plusieurs extraits JSON issus de différentes sections d'un même contrat (même structure de clés).
Fusionne-les en UN SEUL JSON de même structure :
- Dédoublonne (une même obligation citée deux fois = une entrée).
- Conserve les champs "quote", "article" et "qid" INTACTS (ne les réécris jamais ; en cas de doublon, garde la première occurrence).
- Trie les obligations par partie, les dates chronologiquement quand c'est possible.
- Ne perds AUCUNE information matérielle. Réponds UNIQUEMENT en JSON valide.`;

// Plan des sections par groupe de rédaction (ordre du mémo final)
const GROUPS: Record<string, { sections: [string, string][]; instructions: string }> = {
  A: {
    sections: [
      ["objet", "Objet du contrat"],
      ["contexte", "Contexte"],
      ["parties", "Parties"],
      ["economie", "Économie générale du contrat"],
      ["structure", "Structure du document"],
      ["obligations", "Obligations des parties"],
      ["finances", "Conditions financières"],
      ["taux", "Taux d'intérêt et intérêts de retard"],
      ["remboursement", "Modalités de remboursement"],
      ["calendrier", "Calendrier contractuel"],
      ["duree", "Durée, renouvellement et reconduction"],
    ],
    instructions: `Rédige les sections FACTUELLES du mémo. Précision et densité : un Directeur Juridique doit tout comprendre sans ouvrir le contrat.
- "Parties" : identités, rôles, groupes.
- "Économie générale" : la physique du deal en 5-8 lignes — qui apporte quoi, qui paie quoi, qui supporte quels risques.
- "Obligations des parties" : tableau markdown | Partie | Obligation | Échéance | Sanction |.
- "Conditions financières" : commissions, frais et assurances (objet, montant ou taux). N'y répète pas le taux d'intérêt ni l'échéancier : ils ont leur propre section.
- "Taux d'intérêt et intérêts de retard" : indique le taux EXACT (type fixe/variable, pourcentage, base de calcul 360/365) et le régime des intérêts de retard. Si le dossier fixe un taux, ne l'omets JAMAIS ; n'omets cette section que si le dossier ne contient réellement aucun taux.
- "Modalités de remboursement" : profil d'amortissement (nombre d'échéances, périodicité, période de différé, échéance ballon / in fine) et conditions de remboursement anticipé. N'omets cette section que si le dossier est réellement muet sur le remboursement.
- "Calendrier contractuel" : liste chronologique des dates et délais.
- "Contexte" : UNIQUEMENT si le dossier contient des éléments de contexte (préambule, considérants) ; sinon omets entièrement la section.`,
  },
  B: {
    sections: [
      ["garanties", "Garanties"],
      ["responsabilites", "Responsabilités et plafonds"],
      ["resiliation", "Cas de résiliation"],
      ["droit_litiges", "Droit applicable et règlement des litiges"],
      ["pi_confidentialite", "Propriété intellectuelle et confidentialité"],
      ["donnees_personnelles", "Données personnelles (loi 09-08)"],
    ],
    instructions: `Rédige les sections consacrées aux RÉGIMES du contrat. Tu restes STRICTEMENT DESCRIPTIF : tu restitues ce que le contrat stipule (régimes, portées, conditions), sans avis d'opportunité ni qualification de risque.
- "Droit applicable" : sois précis sur l'arbitrage (institution, siège, langue) vs juridictions étatiques.
- "Données personnelles" et "Propriété intellectuelle" : UNIQUEMENT si le dossier contient de la matière ; sinon omets entièrement ces sections.`,
  },
  C: {
    sections: [
      ["questions", "Questions ouvertes"],
      ["executive_summary", "Executive Summary"],
    ],
    instructions: `Termine le mémo, toujours en restant STRICTEMENT DESCRIPTIF.
- "Questions ouvertes" : zones d'ombre du DOCUMENT lui-même — renvois vides, annexes manquantes, définitions absentes, incohérences internes. Constate, ne juge pas.
- "Executive Summary" : rédigé EN DERNIER, 8-12 lignes autoportantes qui résument fidèlement le CONTENU du contrat (objet, parties, économie, régimes clés, dates majeures). Un lecteur pressé ne lira que ça. AUCUNE recommandation, AUCUN avis.`,
  },
};

function composeSystem(group: string, partiesTable?: unknown): string {
  const plan = GROUPS[group];
  const sectionList = plan.sections.map(([id, title]) => `<<<SECTION:${id}|${title}>>>`).join("\n");
  return `Tu es un collaborateur senior d'un cabinet d'avocats d'affaires marocain. Tu rédiges une note de synthèse professionnelle destinée à un Directeur Juridique ou un Associé — un document transmissible tel quel.

NATURE DU DOCUMENT — RÈGLE CARDINALE : cette note est STRICTEMENT DESCRIPTIVE. Elle restitue ce que le contrat stipule, rien d'autre. INTERDITS ABSOLUS : recommandations (« nous recommandons », « il conviendrait de »), avis d'opportunité (signer / ne pas signer / renégocier), qualifications de risque (🔴🟠🟡, « risque élevé », « clause dangereuse »), hiérarchisations par criticité. Si une stipulation est asymétrique ou inhabituelle, décris-la factuellement sans la qualifier.
${partiesClause(partiesTable)}
RÈGLE DE DÉSIGNATION DES PARTIES : à la PREMIÈRE occurrence d'une partie dans chaque section, écris « terme défini (Entité) » — ex. « le Prêteur (Banque X) » ; ensuite, le terme défini seul, IDENTIQUE d'un bout à l'autre du mémo.

RÈGLE ANTI-REDONDANCE : chaque fait n'est énoncé qu'UNE fois, dans la section la plus pertinente. Ne re-développe pas dans une section un élément déjà traité ailleurs (montant du crédit, une même sûreté, un même délai) — tout au plus une brève référence. Si le dossier contient DEUX formulations de la même clause (ex. une hypothèque de premier rang décrite dans deux extraits), FUSIONNE-les en une seule entrée ; ne les liste pas deux fois.

On te fournit le DOSSIER D'INSTRUCTION : un JSON d'extraits factuels du contrat, où chaque élément porte un identifiant "qid" (ex: "q17").

FORMAT DE SORTIE :
- Chaque section commence EXACTEMENT par son marqueur sur sa propre ligne, dans cet ordre :
${sectionList}
- Sous chaque marqueur : du markdown (paragraphes, **gras**, listes -, tableaux |). PAS de titre # (le marqueur fait office de titre).
- CITATIONS : chaque affirmation importante se termine par le(s) marqueur(s) [[q:qid]] des éléments du dossier qui la fondent. Exemple : "La résiliation anticipée emporte une pénalité de 12 mois de loyer [[q:q23]]." N'utilise QUE des qid présents dans le dossier. Ne cite pas de verbatim dans le texte : le marqueur suffit, l'interface affichera la source.
- Si une section marquée "omets si sans matière" n'a pas de matière : n'émets PAS son marqueur du tout.

STYLE : français juridique professionnel, précis, dense, sans remplissage. Jamais de "il semble que" — quand c'est incertain, dis pourquoi. Tu écris pour quelqu'un qui facture son temps.
Si une donnée est absente du dossier (échéance, sanction…), écris "—" ; n'écris JAMAIS "null".

${plan.instructions}

RAPPEL FORMAT — RÈGLES ABSOLUES :
1. Ta réponse COMMENCE directement par le premier marqueur <<<SECTION:...>>> (aucun préambule).
2. N'invente AUCUN titre : pas de #, pas de ##, pas de titres en gras seuls sur une ligne. Les marqueurs <<<SECTION:id|Titre>>> sont les SEULS titres autorisés.
3. Utilise uniquement les marqueurs listés ci-dessus, à l'identique, dans l'ordre.`;
}

// ── Handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));
  const preflightResponse = handleCorsPreFlight(req);
  if (preflightResponse) return preflightResponse;

  if (req.method !== "POST") {
    return errorResponse(405, "Method not allowed", corsHeaders);
  }

  try {
    const { userId } = await authenticateRequest(req);

    const body = await req.json();
    const { mode } = body;

    // ── MODE QUOTA (lecture seule, pour l'UI) ────────────────────────
    if (mode === "quota") {
      try {
        const orgId = await getOrgIdForUser(userId);
        const quotaCheck = await checkOrgQuota(orgId, "synthesis", 0);
        return new Response(JSON.stringify({ quotaCheck }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return errorResponse(500, `Erreur quota: ${err.message}`, corsHeaders);
      }
    }

    // ── QUOTA : appliqué avant tout appel IA facturable ──────────────
    if (mode === "extract" || mode === "compose" || mode === "parties_table") {
      try {
        const orgId = await getOrgIdForUser(userId);
        const quotaCheck = await checkOrgQuota(orgId, "synthesis", 1);
        if (!quotaCheck.allowed) {
          return new Response(JSON.stringify({
            error: quotaCheck.reason || "Quota organisation atteint",
            code: "QUOTA_EXCEEDED",
            remaining_credits: quotaCheck.remaining_credits,
          }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (err) {
        return errorResponse(500, `Erreur quota: ${err.message}`, corsHeaders);
      }
    }

    // ── MODE PARTIES_TABLE (étape 0 : « qui est qui ») ────────────────
    // Un seul appel léger sur l'ouverture du contrat ; la table renvoyée est
    // réinjectée par le client dans extract / consolidate / compose pour une
    // terminologie cohérente (fin des « Prêteur / Banque X / émetteur »).
    if (mode === "parties_table") {
      const { context, doc_name } = body;
      if (!context || typeof context !== "string" || context.length > 40000) {
        return errorResponse(400, "context requis (max 40KB)", corsHeaders);
      }
      try {
        const answer = await callGPT("gpt-4o-mini", [
          { role: "system", content: PARTIES_TABLE_SYSTEM },
          { role: "user", content: `Contrat : ${doc_name || "—"}\n\nDÉBUT DU CONTRAT :\n${context}` },
        ], { maxTokens: 1200, temperature: 0, json: true });
        const parsed = JSON.parse(answer);
        return new Response(JSON.stringify({ parties: Array.isArray(parsed?.parties) ? parsed.parties : [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (_e) {
        // Étape best-effort : sans table, la synthèse reste possible (mode dégradé).
        return new Response(JSON.stringify({ parties: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── MODE EXTRACT (MAP) ───────────────────────────────────────────
    if (mode === "extract") {
      const { context, doc_name } = body;
      if (!context || typeof context !== "string" || context.length > 80000) {
        return errorResponse(400, "context requis (max 80KB)", corsHeaders);
      }
      const answer = await callGPT("gpt-4o-mini", [
        { role: "system", content: EXTRACT_SYSTEM + partiesClause(body.parties_table) },
        { role: "user", content: `Contrat : ${doc_name || "—"}\n\nSECTION À INSTRUIRE :\n${context}` },
      ], { maxTokens: 3000, temperature: 0, json: true });

      return new Response(JSON.stringify({ extract: JSON.parse(answer) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE CONSOLIDATE (REDUCE intermédiaire) ──────────────────────
    if (mode === "consolidate") {
      const { extracts } = body;
      if (!Array.isArray(extracts) || extracts.length === 0) {
        return errorResponse(400, "extracts requis", corsHeaders);
      }
      const payload = JSON.stringify(extracts);
      if (payload.length > 150000) {
        return errorResponse(400, "extracts trop volumineux (max 150KB)", corsHeaders);
      }
      const answer = await callGPT("gpt-4o-mini", [
        { role: "system", content: CONSOLIDATE_SYSTEM + partiesClause(body.parties_table) },
        { role: "user", content: payload },
      ], { maxTokens: 8000, temperature: 0, json: true });

      return new Response(JSON.stringify({ consolidated: JSON.parse(answer) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE COMPOSE (rédaction streamée) ────────────────────────────
    if (mode === "compose") {
      const { dossier, group, doc_meta } = body;
      if (!dossier || !GROUPS[group]) {
        return errorResponse(400, "dossier et group (A|B|C) requis", corsHeaders);
      }
      // Modèle de rédaction paramétrable (test A/B coût/qualité par groupe)
      const COMPOSE_MODELS = ["gpt-4o", "gpt-4o-mini"];
      const composeModel = COMPOSE_MODELS.includes(body.model) ? body.model : "gpt-4o";
      const dossierStr = JSON.stringify(dossier);
      if (dossierStr.length > 200000) {
        return errorResponse(400, "dossier trop volumineux (max 200KB)", corsHeaders);
      }

      let userContent = `DOCUMENT : ${doc_meta?.name || "—"}`;
      if (doc_meta?.pages) userContent += ` (${doc_meta.pages} pages)`;
      userContent += `\n\nDOSSIER D'INSTRUCTION :\n${dossierStr}`;
      // NOTE : l'« analyse de risques préalable » n'est plus injectée — la
      // note de synthèse est strictement descriptive (ni risques, ni
      // recommandations) ; l'analyse de risques vit dans son propre écran.
      if (group === "C" && body.memo_so_far) {
        // Digest du mémo (titres + amorces), pas le texte intégral
        userContent += `\n\nDIGEST DES SECTIONS DÉJÀ RÉDIGÉES (pour l'Executive Summary) :\n${String(body.memo_so_far).slice(0, 15000)}`;
      }

      return await streamGPT(composeModel, [
        { role: "system", content: composeSystem(group, body.parties_table) },
        { role: "user", content: userContent },
      ], 6000, corsHeaders);
    }

    // ── MODE LOG-USAGE (enregistre la consommation de crédits) ────────
    if (mode === "log-usage") {
      try {
        const { operation_type, quantity = 1 } = body;
        if (!operation_type) {
          return errorResponse(400, "operation_type requis", corsHeaders);
        }
        const orgId = await getOrgIdForUser(userId);
        const logged = await logQuotaUsage(orgId, operation_type, quantity);
        if (!logged) {
          return errorResponse(500, "Erreur lors du log de quota", corsHeaders);
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return errorResponse(500, `Erreur log-usage: ${err.message}`, corsHeaders);
      }
    }

    return errorResponse(400, "mode invalide (extract | consolidate | compose | log-usage | quota)", corsHeaders);
  } catch (error) {
    const status = (error as { status?: number })?.status || 500;
    const message = (error as { message?: string })?.message || "Erreur interne";
    console.error("[generate-synthesis]", message);
    return errorResponse(status, message, corsHeaders);
  }
});
