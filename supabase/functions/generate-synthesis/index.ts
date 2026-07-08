import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { authenticateRequest, errorResponse } from "../_shared/auth.ts";

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
  "dates": [{"evenement": "", "date_ou_delai": "", "article": null, "quote": ""}],
  "duree": {"texte": "durée/renouvellement/tacite reconduction", "article": null, "quote": ""},
  "garanties": [{"type": "", "portee": "", "article": null, "quote": ""}],
  "responsabilites": [{"regime": "", "plafond": "", "exclusions": "", "article": null, "quote": ""}],
  "resiliation": [{"cas": "", "preavis": "", "consequences": "", "article": null, "quote": ""}],
  "droit_applicable": {"loi": "", "juridiction": "", "arbitrage": "", "langue": "", "article": null, "quote": ""},
  "pi_confidentialite": [{"sujet": "", "regime": "", "article": null, "quote": ""}],
  "donnees_personnelles": [{"sujet": "", "regime": "", "article": null, "quote": ""}],
  "clauses_sensibles": [{"titre": "", "analyse": "pourquoi c'est sensible", "criticite": "haute|moyenne|basse", "article": null, "quote": ""}],
  "clauses_inhabituelles": [{"titre": "", "en_quoi_inhabituelle": "", "article": null, "quote": ""}],
  "questions_ouvertes": ["zone d'ombre, renvoi vide, annexe manquante…"]
}

RÈGLES IMPÉRATIVES :
- "quote" = COPIE EXACTE du texte source (15-60 mots), jamais reformulée. C'est une exigence absolue : ces verbatims servent à ancrer les citations dans le document.
- N'invente RIEN. Ce qui n'est pas dans la section n'existe pas.
- "article" : uniquement si la référence (Article 5, Clause 12.3…) figure dans le texte.
- Style télégraphique, factuel, sans opinion (l'opinion viendra plus tard).`;

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
      ["calendrier", "Calendrier contractuel"],
      ["duree", "Durée, renouvellement et reconduction"],
    ],
    instructions: `Rédige les sections FACTUELLES du mémo. Précision et densité : un Directeur Juridique doit tout comprendre sans ouvrir le contrat.
- "Parties" : identités, rôles, groupes.
- "Économie générale" : la physique du deal en 5-8 lignes — qui apporte quoi, qui paie quoi, qui supporte quels risques.
- "Obligations des parties" : tableau markdown | Partie | Obligation | Échéance | Sanction |.
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
      ["clauses_sensibles", "Clauses sensibles"],
      ["clauses_inhabituelles", "Clauses inhabituelles"],
    ],
    instructions: `Rédige les sections d'ANALYSE du mémo. Tu passes du factuel à la lecture juridique : régimes, portées, asymétries entre les parties.
- "Droit applicable" : sois précis sur l'arbitrage (institution, siège, langue) vs juridictions étatiques — point critique en droit marocain.
- "Données personnelles" et "Propriété intellectuelle" : UNIQUEMENT si le dossier contient de la matière ; sinon omets entièrement ces sections.
- "Clauses inhabituelles" : compare aux standards de place ; dis en quoi la rédaction s'écarte de l'usage.`,
  },
  C: {
    sections: [
      ["vigilance", "Points de vigilance"],
      ["risques", "Risques par criticité"],
      ["renegociation", "Leviers de renégociation"],
      ["questions", "Questions ouvertes"],
      ["conclusion", "Conclusion et recommandation"],
      ["executive_summary", "Executive Summary"],
    ],
    instructions: `Rédige les sections d'OPINION du mémo. C'est ici que tu apportes la valeur d'un senior : hiérarchiser, alerter, recommander.
- "Risques par criticité" : 🔴 Critique / 🟠 Élevé / 🟡 Modéré / 🟢 Faible, les plus graves d'abord. Si une analyse de risques préalable est fournie dans le dossier, appuie-toi dessus et reste cohérent avec elle.
- "Leviers de renégociation" : pour chaque levier, l'argument à opposer.
- "Questions ouvertes" : zones d'ombre, annexes manquantes, renvois vides.
- "Conclusion et recommandation" : avis actionnable et assumé — signer en l'état / signer après corrections (lesquelles) / ne pas signer.
- "Executive Summary" : rédigé EN DERNIER, 8-12 lignes autoportantes qui synthétisent TON mémo (pas le contrat). Un lecteur pressé ne lira que ça.`,
  },
};

function composeSystem(group: string): string {
  const plan = GROUPS[group];
  const sectionList = plan.sections.map(([id, title]) => `<<<SECTION:${id}|${title}>>>`).join("\n");
  return `Tu es un collaborateur senior d'un cabinet d'avocats d'affaires marocain. Tu rédiges une note de synthèse professionnelle destinée à un Directeur Juridique ou un Associé — un document transmissible tel quel.

On te fournit le DOSSIER D'INSTRUCTION : un JSON d'extraits factuels du contrat, où chaque élément porte un identifiant "qid" (ex: "q17").

FORMAT DE SORTIE :
- Chaque section commence EXACTEMENT par son marqueur sur sa propre ligne, dans cet ordre :
${sectionList}
- Sous chaque marqueur : du markdown (paragraphes, **gras**, listes -, tableaux |). PAS de titre # (le marqueur fait office de titre).
- CITATIONS : chaque affirmation importante se termine par le(s) marqueur(s) [[q:qid]] des éléments du dossier qui la fondent. Exemple : "La résiliation anticipée emporte une pénalité de 12 mois de loyer [[q:q23]]." N'utilise QUE des qid présents dans le dossier. Ne cite pas de verbatim dans le texte : le marqueur suffit, l'interface affichera la source.
- Si une section marquée "omets si sans matière" n'a pas de matière : n'émets PAS son marqueur du tout.

STYLE : français juridique professionnel, précis, dense, sans remplissage. Jamais de "il semble que" — quand c'est incertain, dis pourquoi. Tu écris pour quelqu'un qui facture son temps.

${plan.instructions}`;
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
    await authenticateRequest(req);

    const body = await req.json();
    const { mode } = body;

    // ── MODE EXTRACT (MAP) ───────────────────────────────────────────
    if (mode === "extract") {
      const { context, doc_name } = body;
      if (!context || typeof context !== "string" || context.length > 80000) {
        return errorResponse(400, "context requis (max 80KB)", corsHeaders);
      }
      const answer = await callGPT("gpt-4o-mini", [
        { role: "system", content: EXTRACT_SYSTEM },
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
        { role: "system", content: CONSOLIDATE_SYSTEM },
        { role: "user", content: payload },
      ], { maxTokens: 8000, temperature: 0, json: true });

      return new Response(JSON.stringify({ consolidated: JSON.parse(answer) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MODE COMPOSE (rédaction streamée) ────────────────────────────
    if (mode === "compose") {
      const { dossier, group, doc_meta, audit } = body;
      if (!dossier || !GROUPS[group]) {
        return errorResponse(400, "dossier et group (A|B|C) requis", corsHeaders);
      }
      const dossierStr = JSON.stringify(dossier);
      if (dossierStr.length > 200000) {
        return errorResponse(400, "dossier trop volumineux (max 200KB)", corsHeaders);
      }

      let userContent = `DOCUMENT : ${doc_meta?.name || "—"}`;
      if (doc_meta?.pages) userContent += ` (${doc_meta.pages} pages)`;
      userContent += `\n\nDOSSIER D'INSTRUCTION :\n${dossierStr}`;
      if (group === "C" && audit) {
        userContent += `\n\nANALYSE DE RISQUES PRÉALABLE (reste cohérent avec elle) :\n${JSON.stringify(audit).slice(0, 20000)}`;
      }
      if (group === "C" && body.memo_so_far) {
        userContent += `\n\nSECTIONS DÉJÀ RÉDIGÉES DU MÉMO (pour l'Executive Summary) :\n${String(body.memo_so_far).slice(0, 25000)}`;
      }

      return await streamGPT("gpt-4o", [
        { role: "system", content: composeSystem(group) },
        { role: "user", content: userContent },
      ], 6000, corsHeaders);
    }

    return errorResponse(400, "mode invalide (extract | consolidate | compose)", corsHeaders);
  } catch (error) {
    const status = (error as { status?: number })?.status || 500;
    const message = (error as { message?: string })?.message || "Erreur interne";
    console.error("[generate-synthesis]", message);
    return errorResponse(status, message, corsHeaders);
  }
});
