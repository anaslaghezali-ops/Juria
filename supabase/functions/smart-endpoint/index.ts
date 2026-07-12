import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { checkOrgQuota, logQuotaUsage } from "../_shared/quota-utils.ts";

// Catalogue de livrables par domaine juridique
const DELIVERABLES: Record<string, string[]> = {
  courtier_assurance: ["Checklist complète agrément ACAPS", "Modèle de lettre de demande d'agrément ACAPS", "Comparatif conditions personne physique vs personne morale"],
  assurance: ["Checklist contrat d'assurance", "Modèle de déclaration de sinistre", "Liste des garanties obligatoires au Maroc"],
  travail: ["Modèle de lettre de licenciement", "Checklist procédure disciplinaire", "Calcul indemnités de licenciement"],
  contrat_travail: ["Modèle de contrat de travail CDI", "Checklist période d'essai", "Clause de non-concurrence conforme"],
  sarl: ["Checklist création SARL étape par étape", "Modèle de statuts SARL", "Liste des documents requis au registre de commerce"],
  sa: ["Checklist création SA", "Modèle de statuts SA", "Comparatif SA vs SARL"],
  bail_commercial: ["Modèle de bail commercial", "Checklist renouvellement de bail", "Clause de résiliation conforme COC"],
  bail_habitation: ["Modèle de contrat de bail habitation", "Checklist état des lieux", "Procédure d'expulsion locataire"],
  fonds_commerce: ["Modèle de cession de fonds de commerce", "Checklist acquisition fonds de commerce", "Clause de non-concurrence vendeur"],
  cheque: ["Modèle de mise en demeure chèque impayé", "Procédure d'opposition sur chèque", "Recours pénal chèque sans provision"],
  societe: ["Comparatif SA vs SARL vs SNC", "Checklist immatriculation société", "Modèle de pacte d'associés"],
  licenciement: ["Modèle de lettre de licenciement", "Checklist procédure de licenciement", "Calcul indemnités légales"],
  conge: ["Calcul congés payés Code du Travail", "Modèle de demande de congé", "Procédure refus congé par employeur"],
  salaire: ["Calcul SMIG et cotisations sociales", "Modèle de bulletin de paie", "Procédure recours salaire impayé"],
  faillite: ["Checklist déclaration cessation de paiements", "Procédure redressement judiciaire Maroc", "Droits des créanciers en liquidation"],
  immobilier: ["Checklist acquisition immobilière", "Modèle de compromis de vente", "Procédure inscription conservation foncière"],
  opci: ["Guide des obligations fiscales des OPCI", "Calcul du seuil de distribution minimale (85%/100%)", "Checklist régime de transparence fiscale OPCI"],
  opcvm: ["Comparatif FCP vs SICAV", "Checklist agrément AMMC pour société de gestion", "Guide des obligations de transparence OPCVM"],
  bourse: ["Checklist offre publique (OPA/OPE)", "Guide des obligations de communication financière", "Procédure de cotation à la Bourse de Casablanca"],
  titrisation: ["Guide de la titrisation d'actifs", "Checklist constitution d'un FPCT", "Modèle de convention de cession de créances"],
  capital_risque: ["Guide des OPCR (capital-risque)", "Checklist constitution d'un OPCR", "Comparatif OPCR vs OPCI"],
  financement_collaboratif: ["Guide du crowdfunding au Maroc", "Checklist agrément plateforme de financement collaboratif", "Comparatif financement participatif vs prêt bancaire"],
  default: ["Consulter la base juridique Juria", "Poser une question plus précise", "Contacter un avocat spécialisé"]
};

function getDeliverables(topic: string): string[] {
  const key = topic.toLowerCase();
  // Matching par mots-clés explicites plutot que sous-chaine brute (evite les faux positifs comme "societe" dans une longue phrase)
  const matchers: Record<string, string[]> = {
    opci: ["opci", "placement collectif immobilier"],
    opcvm: ["opcvm", "sicav", "fcp ", "fonds commun de placement"],
    bourse: ["bourse", "offre publique", "opa", "ope", "marche boursier"],
    titrisation: ["titrisation", "fpct"],
    capital_risque: ["capital-risque", "capital risque", "opcr"],
    financement_collaboratif: ["financement collaboratif", "crowdfunding"],
    courtier_assurance: ["courtier", "courtage"],
    assurance: ["assurance", "acaps", "sinistre"],
    contrat_travail: ["contrat de travail", "periode d'essai", "cdi", "cdd"],
    travail: ["licenciement", "salarie", "employeur", "travail"],
    sarl: ["sarl"],
    sa: [" sa ", "societe anonyme"],
    bail_commercial: ["bail commercial"],
    bail_habitation: ["bail habitation", "bail d'habitation"],
    fonds_commerce: ["fonds de commerce"],
    cheque: ["cheque"],
    societe: ["societe", "actionnaire", "sarl", "sas"],
    conge: ["conge"],
    salaire: ["salaire", "smig", "remuneration"],
    faillite: ["faillite", "redressement judiciaire", "liquidation"],
    immobilier: ["immobilier", "immeuble", "foncier"],
  };
  for (const [k, patterns] of Object.entries(matchers)) {
    if (patterns.some(p => key.includes(p))) return DELIVERABLES[k];
  }
  return DELIVERABLES.default;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  // Handle CORS preflight
  const preflightResponse = handleCorsPreFlight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Session invalide" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // L'ancien quota « 20 questions par utilisateur » (user_profiles_compat)
    // est supprimé : la consommation est régie par le quota v2 en crédits
    // d'ORGANISATION (checkOrgQuota/logQuotaUsage), vérifié par mode.
    const body = await req.json();
    const { question, contract_to_analyze, mode, history, document_context, conversation_context, perspective } = body;
    const conversationHistory: any[] = history || [];

    // Perspective d'analyse : la partie que défend l'utilisateur (nom libre issu
    // du contrat). Vide / "neutre" => analyse impartiale (comportement historique).
    // On ne DÉDUIT jamais le camp : il est fourni explicitement par le client.
    const perspRaw = typeof perspective === "string" ? perspective.trim() : "";
    const persp = /^(neutre|neutral|)$/i.test(perspRaw) ? "" : perspRaw.slice(0, 120);
    const perspClause = persp
      ? `POINT DE VUE : tu conseilles « ${persp} » (une des parties au contrat). Juge chaque point du point de vue de SES intérêts : ce qui protège ou avantage « ${persp} » est favorable ; ce qui l'expose, le contraint ou réduit ses droits est défavorable.`
      : "";

    if (!question || typeof question !== "string" || question.length > 600) {
      return new Response(JSON.stringify({ error: "Question invalide" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "Clé OpenAI manquante" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get organization ID for quota system v2 (lien via organization_users)
    let orgId: string | null = null;
    try {
      const { data: membership } = await supabaseAdmin
        .from("organization_users")
        .select("organization_id")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      orgId = membership?.organization_id || null;
    } catch (e) {
      console.warn("[smart-endpoint] Failed to get org_id:", e);
    }

    // Appel OpenAI avec retries + backoff exponentiel. Les 429 (rate limit)
    // et 5xx transitoires sont réessayés (en respectant Retry-After) au lieu
    // de faire échouer toute l'analyse. Après épuisement des tentatives, on
    // lève une erreur porteuse du statut (aiStatus) pour un message client clair.
    const openaiFetch = async (url: string, body: unknown, attempt = 0): Promise<Response> => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, waitMs + Math.random() * 300));
        return openaiFetch(url, body, attempt + 1);
      }
      return res;
    };

    const chatBody = (messages: any[], maxTokens: number, jsonMode: boolean) => ({
      model: "gpt-4o-mini",
      messages,
      max_tokens: maxTokens,
      temperature: 0.1,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    });

    const throwAiError = (res: Response) => {
      const e: any = new Error("OpenAI error: " + res.status);
      e.aiStatus = res.status;
      throw e;
    };

    const callOpenAI = async (systemPrompt: string, userContent: string, maxTokens: number, jsonMode = true) => {
      const res = await openaiFetch(
        "https://api.openai.com/v1/chat/completions",
        chatBody([
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ], maxTokens, jsonMode),
      );
      if (!res.ok) throwAiError(res);
      const data = await res.json();
      const text = data.choices[0].message.content;
      return jsonMode ? JSON.parse(text) : text;
    };

    const callOpenAIMessages = async (messages: any[], maxTokens: number, jsonMode = true) => {
      const res = await openaiFetch(
        "https://api.openai.com/v1/chat/completions",
        chatBody(messages, maxTokens, jsonMode),
      );
      if (!res.ok) throwAiError(res);
      const data = await res.json();
      const text = data.choices[0].message.content;
      return jsonMode ? JSON.parse(text) : text;
    };

    const vectorSearch = async (query: string, count = 30, codes: string[] = []) => {
      const embRes = await openaiFetch("https://api.openai.com/v1/embeddings", {
        model: "text-embedding-3-small", input: query,
      });
      if (!embRes.ok) return [];
      const embData = await embRes.json();
      const embedding = embData.data[0].embedding;

      // Hybrid search : vector (65%) + BM25 full-text (35%)
      const { data: articles, error } = await supabaseAdmin.rpc("hybrid_search", {
        query_text: query,
        query_embedding: embedding,
        match_count: count,
        vector_weight: 0.65,
        bm25_weight: 0.35,
      });

      if (error) {
        console.warn("Hybrid search failed, falling back to vector only:", error);
        const { data: fallback } = await supabaseAdmin.rpc("search_articles", {
          query_embedding: embedding,
          match_count: count,
        });
        return fallback || [];
      }

      // Filtrer par code si le classifier est confiant
      if (codes.length > 0) {
        const filtered = (articles || []).filter((a: any) => codes.includes(a.code));
        // Si le filtre retourne assez d'articles, on l'utilise
        if (filtered.length >= 10) {
          console.log("Code filter applied:", codes, "->", filtered.length, "articles");
          return filtered;
        }
        // Sinon on garde tous les résultats (le filtre était trop restrictif)
        console.log("Code filter too restrictive, using all results");
      }

      return articles || [];
    };

    // ---- DETECTION MODE CONVERSATION NATURELLE ----
    const conversationPatterns = [
      /^(bonjour|bonsoir|salut|hello|hi|hey|salam)/i,
      /^(merci|thank|شكرا)/i,
      /^(comment vas|ça va|ca va)/i,
      /^(au revoir|bye|bonne journée)/i,
      /^(ok|okay|d'accord|parfait|super|génial)/i,
      /^(qui es.tu|qu'est.ce que juria|présente.toi)/i,
    ];
    const isConversation = conversationPatterns.some(p => p.test(question.trim()));

    if (isConversation) {
      const chatSystem = "Tu es Juria, un assistant juridique marocain sympathique. Réponds naturellement et chaleureusement. Si on te demande qui tu es, présente-toi comme Juria, l'assistant juridique marocain. Retourne UNIQUEMENT un JSON: {\"answer\": \"ta réponse\", \"used_indices\": [], \"based_on_articles\": false}";
      const result = await callOpenAI(chatSystem, question, 300);
      return new Response(JSON.stringify({ answer: result.answer || "", citations: [], is_contract: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- MODE PARTIES (extraction légère pour le sélecteur de perspective) ----
    // Renvoie juste les parties nommées au contrat. Bon marché (petit prompt),
    // non facturé : sert à proposer « Je représente : [X] / [Y] » avant l'analyse.
    if (mode === "parties") {
      const sample = String(contract_to_analyze || body.contract_v1 || document_context || "").slice(0, 8000);
      if (!sample.trim()) {
        return new Response(JSON.stringify({ parties: [] }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const out = await callOpenAI(
          "Tu es juriste. Identifie les parties nommées à ce contrat (bailleur/preneur, employeur/salarié, vendeur/acheteur, sociétés…). Retourne UNIQUEMENT un JSON {\"parties\": [\"...\", \"...\"]} avec leur désignation telle qu'écrite (max 4).",
          sample,
          200,
        );
        const parties = Array.isArray(out?.parties) ? out.parties.filter((p: any) => typeof p === "string" && p.trim()).slice(0, 4) : [];
        return new Response(JSON.stringify({ parties }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (_e) {
        return new Response(JSON.stringify({ parties: [] }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ---- MODE QUESTION SUR DOCUMENT ----
    if (mode === "document_question" && document_context) {
      // Check quota v2 if organization is available (chat = 0.1 credit per message, rounded to 1 for simplicity)
      if (orgId) {
        const quotaCheck = await checkOrgQuota(orgId, "chat", 1);
        if (!quotaCheck.allowed) {
          return new Response(JSON.stringify({
            error: quotaCheck.reason || "Quota organisation atteint pour les chats",
            code: "QUOTA_EXCEEDED",
            remaining_credits: quotaCheck.remaining,
          }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const docSystem = [
        "Tu es Juria, expert juridique marocain.",
        "L'utilisateur a uploadé un document et pose une question dessus.",
        "Réponds en te basant UNIQUEMENT sur le contenu du document fourni.",
        "Si la réponse ne figure pas dans le document, dis-le clairement.",
        "Cite les passages pertinents du document dans ta réponse.",
        "Retourne UNIQUEMENT un JSON avec: answer (string), used_article_ids (tableau vide), needs_clarification (false)",
      ].join(" ");

      const docMessages: any[] = [{ role: "system", content: docSystem }];
      conversationHistory.slice(-4).forEach((msg: any) => {
        docMessages.push({ role: msg.role, content: msg.content.slice(0, 200) });
      });
      docMessages.push({
        role: "user",
        content: "Document: " + document_context + " | Question: " + question,
      });

      const docResult = await callOpenAIMessages(docMessages, 1000);

      // Log quota usage asynchronously
      if (orgId) {
        logQuotaUsage(orgId, "chat", 1).catch(e =>
          console.warn("[smart-endpoint] Quota log failed:", e)
        );
      }

      return new Response(
        JSON.stringify({ answer: docResult.answer || "", citations: [], is_contract: false, needs_clarification: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- MODE COMPARAISON DE CONTRATS (diff aligné, lit tout) ----
    if (mode === "compare" && (body.contract_v1 || body.contract_v2 || document_context)) {
      // Transport robuste : contract_v1 / contract_v2 en champs séparés.
      // (L'ancien transport concaténait "CONTRAT V1 --- CONTRAT V2" puis
      // splittait sur "---" : un contrat contenant "---" cassait le découpage.)
      // Compat conservée pour les fronts en cache.
      let v1 = typeof body.contract_v1 === "string" ? body.contract_v1 : "";
      let v2 = typeof body.contract_v2 === "string" ? body.contract_v2 : "";
      if (!v1 && !v2 && document_context) {
        const parts = document_context.split("---");
        v1 = parts[0] ? parts[0].replace("CONTRAT V1:", "").trim() : "";
        v2 = parts[1] ? parts[1].replace("CONTRAT V2:", "").trim() : "";
      }

      // Fenêtres V1 contiguës ; V2 est partitionné par ANCRAGE : le début de
      // chaque fenêtre V1 est recherché textuellement dans V2 (les intitulés
      // de clauses inchangés servent d'ancres). À défaut, prorata positionnel.
      // Chaque paire couvre ainsi TOUT V1 et TOUT V2 : une clause supprimée
      // manque dans la zone V2 de sa paire, une clause ajoutée apparaît dans
      // la zone V2 entre deux ancres.
      const WINDOW = 14000;
      const MAX_WINDOWS = 8;   // ~110k caractères par version (~40 pages)
      const V2_MARGIN = 800;   // chevauchement : une clause en bordure reste visible entière
      const starts: number[] = [];
      for (let p = 0; p < Math.max(1, v1.length) && starts.length < MAX_WINDOWS; p += WINDOW) {
        starts.push(p);
      }
      const anchors: number[] = [0];
      for (let i = 1; i < starts.length; i++) {
        const probe = v1.slice(starts[i], starts[i] + 140).trim();
        let pos = probe.length >= 40 ? v2.indexOf(probe, anchors[i - 1]) : -1;
        if (pos === -1) {
          const probe2 = v1.slice(starts[i] + 200, starts[i] + 320).trim();
          pos = probe2.length >= 40 ? v2.indexOf(probe2, anchors[i - 1]) : -1;
        }
        if (pos === -1) pos = Math.round((starts[i] / Math.max(1, v1.length)) * v2.length);
        anchors.push(Math.max(pos, anchors[i - 1]));
      }
      anchors.push(v2.length);

      // Quota v2 : facturé au volume réellement comparé (1 unité par paire)
      if (orgId) {
        const quotaCheck = await checkOrgQuota(orgId, "doc_comparison", starts.length);
        if (!quotaCheck.allowed) {
          return new Response(JSON.stringify({
            error: quotaCheck.reason || "Quota organisation atteint pour les comparaisons",
            code: "QUOTA_EXCEEDED",
            remaining_credits: quotaCheck.remaining_credits,
          }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const compareSystemFor = (part: number, total: number) => [
        "Tu es expert juridique marocain senior. Compare ces deux versions d'un même contrat et identifie CHAQUE différence réelle de fond.",
        total > 1
          ? `\n⚠️ Tu reçois la PARTIE ${part}/${total} de chaque version, alignées approximativement. Une clause TRONQUÉE au bord d'une partie ne doit PAS être signalée comme supprimée ou ajoutée.\n`
          : "",
        "",
        "CLASSIFICATION DU TYPE — applique STRICTEMENT ces définitions :",
        "- 'modification' : la clause existe dans V1 ET dans V2 mais son texte diffère (montant, date, durée, portée, bénéficiaire…). v1 ET v2 sont remplis.",
        "- 'suppression' : clause présente dans V1 et TOTALEMENT ABSENTE de V2. v2 est vide.",
        "- 'ajout' : clause ABSENTE de V1 et présente dans V2. v1 est vide.",
        "RÈGLE ANTI-ERREUR : si V2 contient encore la clause (même reformulée), ce n'est JAMAIS une 'suppression' → c'est une 'modification'. Une clause présente uniquement dans V2 est un 'ajout', jamais une 'suppression'. Le 'type' DOIT être cohérent avec v1/v2 (suppression ⇒ v2 vide ; ajout ⇒ v1 vide ; modification ⇒ les deux remplis).",
        "",
        perspClause,
        persp
          ? `Détermine "sens" en RAISONNANT EN 2 TEMPS pour chaque changement : (1) identifie QUELLE partie est TENUE par l'obligation/la contrainte et QUELLE partie en BÉNÉFICIE — « le salarié se déplace / exécute / paie / ne fait pas concurrence / garde le secret » = obligation DU SALARIÉ (favorable à l'employeur). (2) Déduis pour « ${persp} » : "favorable" si le changement renforce ses droits/protections OU restreint/oblige l'AUTRE partie ; "défavorable" seulement s'il le contraint, réduit ses droits ou lui impose une charge ; "neutre" sinon. RÈGLE CLÉ : une clause qui RESTREINT ou OBLIGE l'AUTRE partie (non-concurrence, confidentialité, pénalités, sûretés, exclusivité à la charge de l'autre) PROTÈGE « ${persp} » → "favorable", JAMAIS "défavorable". La "description" DOIT dire quelle partie est tenue et pourquoi c'est (dé)favorable à « ${persp} ». Pour un "défavorable" : "suggestion" = une rédaction concrète protégeant « ${persp} » ; sinon "suggestion": "".`
          : 'Ajoute "sens": "neutre" et "suggestion": "" à chaque changement (aucune partie choisie).',
        "",
        "📝 FORMAT REQUIS - Retourne UNIQUEMENT JSON valide:",
        '{"summary": "résumé global", "parties": ["Nom partie 1", "Nom partie 2"], "changes": [',
        '  {"type": "suppression", "clause": "Nom clause", "v1": "texte V1", "v2": "", "impact": "majeur", "sens": "défavorable", "description": "Explication", "suggestion": "Texte à proposer"},',
        '  {"type": "modification", "clause": "Nom clause", "v1": "texte V1", "v2": "texte V2", "impact": "majeur", "sens": "favorable", "description": "Explication", "suggestion": ""},',
        '  {"type": "ajout", "clause": "Nom clause", "v1": "", "v2": "texte V2", "impact": "mineur", "sens": "neutre", "description": "Explication", "suggestion": ""}',
        "]}",
        "",
        '"parties" = les 2 (ou plus) parties nommées au contrat, telles qu\'écrites (ex: "le Bailleur", "OCP SA"). Toujours renseigné.',
        "Types UNIQUEMENT: ajout, suppression, modification. Impact: majeur, mineur, neutre. sens: favorable, défavorable, neutre. PAS de 'deletion', 'added', 'changed'.",
        "Chaque changement DOIT avoir: type, clause, v1, v2, impact, sens, description, suggestion",
        "",
        "🔴 RÈGLE SUR v1 ET v2: cite le TEXTE INTÉGRAL de la clause concernée, mot pour mot, tel qu'il apparaît dans le contrat. NE RÉSUME PAS, NE PARAPHRASE PAS, NE TRONQUE PAS. Pour une suppression: v1 = texte complet de la clause supprimée. Pour un ajout: v2 = texte complet de la clause ajoutée. Pour une modification: cite les passages complets concernés dans v1 et v2.",
        "Si aucune différence trouvée: {\"summary\": \"Aucune différence\", \"changes\": []}",
      ].join("\n");

      const parseCompare = (rawResult: any) => {
        try {
          const answer = rawResult.answer || JSON.stringify(rawResult);
          const clean = answer.replace(/```json/g, "").replace(/```/g, "").trim();
          const start = clean.indexOf("{");
          const end = clean.lastIndexOf("}");
          if (start !== -1 && end !== -1) return JSON.parse(clean.slice(start, end + 1));
        } catch (_e) { /* ignore */ }
        return { summary: rawResult?.answer || "Erreur parsing", changes: [] };
      };

      // MAP : diff de chaque paire alignée, 3 appels en parallèle maximum
      const pairResults: any[] = new Array(starts.length);
      let nextPair = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, starts.length) }, async () => {
          while (nextPair < starts.length) {
            const i = nextPair++;
            const v1Slice = v1.slice(starts[i], starts[i] + WINDOW);
            const v2Slice = v2.slice(Math.max(0, anchors[i] - V2_MARGIN), Math.min(v2.length, anchors[i + 1] + V2_MARGIN));
            const raw = await callOpenAIMessages([
              { role: "system", content: compareSystemFor(i + 1, starts.length) },
              { role: "user", content: "CONTRAT V1 (original)" + (starts.length > 1 ? ` — partie ${i + 1}/${starts.length}` : "") + ":\n" + v1Slice + "\n\n=====\n\nCONTRAT V2 (modifié), zone correspondante:\n" + v2Slice },
            ], 3000);
            pairResults[i] = parseCompare(raw);
          }
        }),
      );

      // REDUCE : fusion + dédoublonnage (les marges V2 peuvent faire voir un
      // même ajout dans deux paires voisines)
      let compareData = pairResults[0] || { summary: "", changes: [] };
      if (starts.length > 1) {
        const allChanges = pairResults.flatMap((r) => Array.isArray(r?.changes) ? r.changes : []);
        const partSummaries = pairResults.map((r, i) => `Partie ${i + 1}: ${r?.summary || "—"}`).join(" | ");
        const mergeRaw = await callOpenAIMessages([
          {
            role: "system",
            content: [
              "Tu es expert juridique marocain. On te donne les changements détectés sur les parties successives d'une comparaison de deux versions d'un MEME contrat.",
              "Fusionne en un résultat global : DÉDOUBLONNE les changements qui décrivent la même clause (les zones se chevauchent aux bords), en conservant la version la plus complète.",
              "Écris un summary global (2-4 phrases) hiérarchisant les changements majeurs.",
              perspClause,
              "Types UNIQUEMENT: ajout, suppression, modification. Impact: majeur, mineur, neutre. sens: favorable, défavorable, neutre.",
              'Retourne UNIQUEMENT un JSON: {"summary": "...", "parties": ["...","..."], "changes": [{"type","clause","v1","v2","impact","sens","description","suggestion"}]}',
              "Conserve INTÉGRALEMENT chaque champ fourni (v1, v2, sens, suggestion) sans le résumer ni le vider.",
            ].join("\n"),
          },
          { role: "user", content: "Résumés partiels: " + partSummaries + "\n\nChangements détectés: " + JSON.stringify(allChanges).slice(0, 90000) },
        ], 6000);
        compareData = parseCompare(mergeRaw);
        if (!Array.isArray(compareData.changes) || (compareData.changes.length === 0 && allChanges.length > 0)) {
          // Filet de sécurité : si la fusion échoue, renvoyer la concaténation brute
          compareData = { summary: partSummaries, changes: allChanges };
        }
        // Les parties peuvent manquer après fusion : reprendre celles d'une partie.
        if (!Array.isArray(compareData.parties) || compareData.parties.length === 0) {
          const firstParties = pairResults.find((r) => Array.isArray(r?.parties) && r.parties.length)?.parties;
          if (firstParties) compareData.parties = firstParties;
        }
      }


      // Log quota usage asynchronously (facturé au nombre de paires comparées)
      if (orgId) {
        logQuotaUsage(orgId, "doc_comparison", starts.length).catch(e =>
          console.warn("[smart-endpoint] Quota log failed:", e)
        );
      }

      return new Response(
        JSON.stringify(compareData),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- MODE ANALYSE DE CONTRAT (map-reduce : lit TOUT le contrat) ----
    if (mode === "analyze" && contract_to_analyze) {
      // L'ancienne version tronquait a 8 000 caracteres : tout ce qui se
      // trouvait au-dela de ~3 pages n'etait JAMAIS analyse. Le contrat est
      // desormais decoupe en fenetres avec chevauchement : chaque fenetre est
      // analysee (map), puis les analyses partielles sont fusionnees (reduce).
      const WINDOW_CHARS = 9000;   // ~2 250 tokens par fenetre
      const OVERLAP_CHARS = 600;   // une clause a cheval sur deux fenetres est vue en entier au moins une fois
      const MAX_WINDOWS = 12;      // plafond ~100k caracteres (~40 pages)
      const fullText = String(contract_to_analyze);
      const windows: string[] = [];
      let cursor = 0;
      while (cursor < fullText.length && windows.length < MAX_WINDOWS) {
        windows.push(fullText.slice(cursor, cursor + WINDOW_CHARS));
        if (cursor + WINDOW_CHARS >= fullText.length) break;
        cursor += WINDOW_CHARS - OVERLAP_CHARS;
      }
      if (windows.length === 0) windows.push(fullText);

      // Quota v2 : facture au volume reellement analyse (1 unite par fenetre).
      // Un contrat court coute comme avant ; 40 pages coutent 12 unites.
      if (orgId) {
        const quotaCheck = await checkOrgQuota(orgId, "risk_analysis", windows.length);
        if (!quotaCheck.allowed) {
          // Message actionnable : le cout depend de la taille du document
          // (1 credit par fenetre de ~3 pages), ce que l'utilisateur ne peut
          // pas deviner depuis un simple "quota atteint".
          const remaining = quotaCheck.remaining_credits ?? 0;
          return new Response(JSON.stringify({
            error: `Crédits insuffisants : ce document nécessite ${windows.length} crédit${windows.length > 1 ? "s" : ""} d'analyse (1 par tranche d'environ 3 pages) et il en reste ${remaining}. Augmentez le quota mensuel ou analysez un document plus court.`,
            code: "QUOTA_EXCEEDED",
            required_credits: windows.length,
            remaining_credits: remaining,
          }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const articles = await vectorSearch(question, 6);
      const articlesContext = articles.length > 0
        ? articles.map((a: any) => a.numero_article + " : " + a.contenu).join(" === ")
        : "";
      const analyzeSystemFor = (part: number, total: number) => [
        "Tu es Juria, expert juridique marocain senior specialise en droit des contrats.",
        perspClause,
        persp
          ? `Pour CHAQUE "issue", détermine "sens" en 2 temps : (1) identifie QUELLE partie est TENUE par la clause et QUELLE partie en BÉNÉFICIE — « le salarié se déplace / exécute / paie / ne fait pas concurrence / garde le secret » = obligation DU SALARIÉ. (2) Déduis pour « ${persp} » : "favorable" si la clause protège « ${persp} » OU restreint/oblige l'AUTRE partie ; "défavorable" seulement si elle pèse réellement sur « ${persp} » ou réduit SES droits ; "neutre" sinon. RÈGLE CLÉ : une clause qui RESTREINT ou OBLIGE l'AUTRE partie (non-concurrence, confidentialité, pénalités, sûretés, exclusivité à la charge de l'autre) PROTÈGE « ${persp} » → "favorable", JAMAIS "défavorable". Ne force pas un angle défavorable : si une clause protège « ${persp} », marque-la "favorable" (ne l'invente pas comme problème). "problem" doit dire quelle partie est tenue ; oriente "suggestion" pour protéger « ${persp} ».`
          : 'Ajoute "sens": "neutre" à chaque issue (aucune partie choisie).',
        total > 1
          ? `Tu recois la PARTIE ${part}/${total} d'un contrat plus long (decoupage avec chevauchement). Analyse UNIQUEMENT ce qui figure dans cette partie ; les clauses manquantes seront recoupees avec les autres parties.`
          : "",
        "ETAPE 1: Identifie le type de contrat (contrat de travail, bail commercial, bail habitation, promesse de bail, contrat de vente, contrat de societe, ou autre).",
        "ETAPE 2: Applique UNIQUEMENT les regles juridiques du domaine concerne.",
        "Si CONTRAT DE TRAVAIL: Code du Travail Loi 65-99. SMIG=3111 MAD, periode essai cadres=3 mois renouvelable, conges=18 jours/an Art.231.",
        "Si BAIL COMMERCIAL ou PROMESSE DE BAIL: COC Art.627-750 et loi 49-16. Verifications: duree, loyer, depot garantie, resiliation, etat des lieux.",
        "Si BAIL HABITATION: COC et loi 67-12. Verifications: loyer, charges, duree, resiliation, depot garantie.",
        "Si CONTRAT DE VENTE: COC Art.478-635. Verifications: prix, paiement, transfert propriete, garanties.",
        "Si CONTRAT DE SOCIETE: loi 17-95 SA ou loi 5-96 SARL selon type.",
        "REGLES ABSOLUES:",
        "1. Ne jamais appliquer le Code du Travail a un bail ou a un contrat qui n'est pas un contrat de travail.",
        "2. Ne signale comme probleme QUE ce qui viole la loi applicable au type de contrat identifie.",
        "3. Pour chaque probleme, donne une suggestion CONCRETE avec le texte exact a ajouter ou modifier.",
        "4. Pour les clauses manquantes, cite l'article de loi applicable et donne un exemple de formulation.",
        "5. Score: 10=parfaitement conforme, 1=illegal selon le droit marocain applicable.",
        "6. Extrais aussi les OBLIGATIONS ET ECHEANCES du contrat : toute date butoir, delai de preavis, date de renouvellement, obligation periodique (rapport, paiement, declaration) ou condition a satisfaire avant une date. due_date au format YYYY-MM-DD si la date est determinable (calcule-la a partir des dates du contrat si necessaire), sinon null. is_critical=true si le non-respect entraine resiliation, penalite ou perte de droit.",
        "Articles de reference: " + articlesContext,
        "Retourne UNIQUEMENT un JSON: {contract_type: string, score: number, summary: string, parties: [string], issues: [{paragraph_id: number, severity: string, clause: string, problem: string, suggestion: string, sens: string}], missing_clauses: [string], obligations: [{description: string, due_date: string|null, is_critical: boolean}]}. parties = les parties nommees au contrat (telles qu'ecrites). sens parmi favorable/défavorable/neutre. paragraph_id = le numero entre crochets [N] du paragraphe concerne dans le contrat fourni.",
      ].filter(Boolean).join(" ");

      // MAP : analyse de chaque fenetre. Concurrence limitee a 2 (au lieu de 4)
      // pour ne pas saturer le rate limit OpenAI ; le backoff d'openaiFetch
      // absorbe les 429 residuels.
      const partResults: any[] = new Array(windows.length);
      let nextWindow = 0;
      await Promise.all(
        Array.from({ length: Math.min(2, windows.length) }, async () => {
          while (nextWindow < windows.length) {
            const i = nextWindow++;
            partResults[i] = await callOpenAI(
              analyzeSystemFor(i + 1, windows.length),
              "Contrat" + (windows.length > 1 ? ` (partie ${i + 1}/${windows.length})` : "") + ": " + windows[i],
              1500,
            );
          }
        }),
      );

      // REDUCE : fusion des analyses partielles en une analyse globale
      let analysis = partResults[0];
      if (windows.length > 1) {
        const mergeSystem = [
          "Tu es Juria, expert juridique marocain senior. On te donne les analyses partielles d'un MEME contrat, decoupe en parties avec chevauchement.",
          "Fusionne-les en UNE analyse globale coherente :",
          "- contract_type : le type identifie par la majorite des parties.",
          "- parties : les parties nommees au contrat (union des parties detectees).",
          "- issues : rassemble toutes les issues ; DEDOUBLONNE celles qui decrivent la meme clause (le chevauchement fait qu'une clause peut apparaitre dans deux parties) ; conserve le paragraph_id d'origine, la severity la plus haute et le champ 'sens' en cas de doublon.",
          "- missing_clauses : une clause n'est manquante que si AUCUNE partie ne la contient. Retire toute clause signalee manquante par une partie mais presente ou traitee dans une autre.",
          "- obligations : rassemble toutes les obligations/echeances ; dedoublonne celles qui decrivent la meme obligation (garde is_critical=true et la due_date la plus precise en cas de doublon).",
          "- score : score global 1-10 du contrat ENTIER (10 = parfaitement conforme), coherent avec la gravite cumulee des issues retenues.",
          "- summary : synthese globale en 2-4 phrases.",
          perspClause,
          "Conserve le champ 'sens' (favorable/défavorable/neutre) de chaque issue.",
          "Retourne UNIQUEMENT un JSON: {contract_type: string, score: number, summary: string, parties: [string], issues: [{paragraph_id: number, severity: string, clause: string, problem: string, suggestion: string, sens: string}], missing_clauses: [string], obligations: [{description: string, due_date: string|null, is_critical: boolean}]}",
        ].join(" ");
        analysis = await callOpenAI(
          mergeSystem,
          "Analyses partielles (dans l'ordre du contrat) : " + JSON.stringify(partResults).slice(0, 90000),
          3000,
        );
      }


      // Log quota usage asynchronously (facture au nombre de fenetres analysees)
      if (orgId) {
        logQuotaUsage(orgId, "risk_analysis", windows.length).catch(e =>
          console.warn("[smart-endpoint] Quota log failed:", e)
        );
      }

      return new Response(JSON.stringify(analysis), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // ---- MODE LIVRABLE (génération de document) ----
    if (mode === "deliverable") {
      if (orgId) {
        const quotaCheck = await checkOrgQuota(orgId, "chat", 1);
        if (!quotaCheck.allowed) {
          return new Response(JSON.stringify({
            error: quotaCheck.reason || "Quota organisation atteint",
            code: "QUOTA_EXCEEDED",
            remaining_credits: quotaCheck.remaining_credits,
          }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
      const deliverableSystem = [
        "Tu es Juria, expert juridique marocain senior. Tu génères des documents professionnels structurés pour des praticiens du droit.",
        "Le document doit être complet, précis, directement utilisable et basé sur le droit marocain.",
        "Structure: ## Titre de section pour chaque partie principale, **texte en gras** pour les points importants, listes avec - pour les étapes/points.",
        "Ne pas inclure de disclaimer ou d'avertissement dans le corps du document - seulement le contenu substantiel.",
        "Longueur: document complet de 400-800 mots minimum, pas une simple réponse.",
                "Retourne UNIQUEMENT un JSON avec les champs: answer (string, contenu du document), used_article_ids (liste vide), needs_clarification (false)",
      ].join(" ");

      const deliverableMessages: any[] = [
        { role: "system", content: deliverableSystem },
        { role: "user", content: question }
      ];

      const delivResult = await callOpenAIMessages(deliverableMessages, 2000);
      if (orgId) {
        logQuotaUsage(orgId, "chat", 1).catch(e => console.warn("[smart-endpoint] Quota log failed:", e));
      }
      return new Response(
        JSON.stringify({ answer: delivResult.answer || "", citations: [], is_contract: false, needs_clarification: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- MODE QUESTION JURIDIQUE ----
    // Quota v2 : les questions juridiques générales consomment des crédits
    // "chat" comme les questions sur document (trou de facturation corrigé).
    if (orgId) {
      const quotaCheck = await checkOrgQuota(orgId, "chat", 1);
      if (!quotaCheck.allowed) {
        return new Response(JSON.stringify({
          error: quotaCheck.reason || "Quota organisation atteint",
          code: "QUOTA_EXCEEDED",
          remaining_credits: quotaCheck.remaining_credits,
        }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ETAPE 1 : Reconstruire la question comme une question autonome (remplace l'ancienne extraction de "topic")
    let searchQuery = question;
    let standaloneQuestion = question;
    try {
      if (conversationHistory.length > 0) {
        // On prend plus de contexte (8 derniers messages au lieu de 4) pour ne pas perdre la question initiale
        const fullHistory = conversationHistory.slice(-8)
          .map((m: any) => (m.role === "user" ? "Utilisateur: " : "Juria: ") + m.content.slice(0, 400))
          .join("\n");

        const rewritePrompt = [
          "Tu es un reformulateur de questions juridiques marocaines.",
          "Voici l'historique d'une conversation, suivi du dernier message de l'utilisateur.",
          "Le dernier message peut etre une correction, precision ou restriction d'une question precedente (ex: 'je parle de X', 'il me semble que...', 'non je veux dire...').",
          "Reecris le dernier message comme UNE SEULE question juridique autonome et complete, qui inclut tout le contexte necessaire (sujet, entites juridiques, lois, hypotheses, corrections) pour etre comprise SANS l'historique.",
          "Si le dernier message restreint ou precise le sujet (ex: 'je parle des OPCI'), la question reconstruite DOIT porter specifiquement sur ce sujet restreint, pas sur le sujet general precedent.",
          "Ne reponds PAS a la question. Retourne UNIQUEMENT la question reconstruite, rien d'autre.",
        ].join(" ");

        const rewritten = await callOpenAI(
          rewritePrompt,
          "Historique:\n" + fullHistory + "\n\nDernier message de l'utilisateur: " + question,
          120,
          false
        );

        if (rewritten && rewritten.trim().length > 5) {
          standaloneQuestion = rewritten.trim();
          console.log("Question reconstruite:", question, "->", standaloneQuestion);
        }
      }

      // On utilise directement la question autonome pour la recherche (hybrid search BM25+embeddings gere deja le matching)
      // L'ancienne compression en mots-cles perdait des termes discriminants (ex: "loi 70-14", "part minimale")
      searchQuery = standaloneQuestion;
      console.log("Search query (standalone):", searchQuery);
    } catch(e) {
      console.warn("Reformulation failed:", e);
    }

    // ETAPE 2 (supprimée) : le classifier de codes était désactivé depuis le
    // 21/06 (il excluait à tort les lois spécialisées type OPCI absentes de sa
    // liste) mais l'appel GPT restait exécuté à CHAQUE question, pour rien.
    // La recherche hybride BM25+vecteur couvre tous les codes sans filtre.
    const codeFilter: string[] = [];

    // ETAPE 3 : Recherche hybride — Top 30 candidats
    const candidateArticles = await vectorSearch(searchQuery, 30, codeFilter);

    // DEBUG: logguer le TOP30 brut avant reranking pour diagnostiquer si le retrieval trouve les bons articles
    console.log("TOP30:", JSON.stringify(candidateArticles.map((a: any) => ({ ref: a.numero_article, code: a.code }))));

    if (!candidateArticles || candidateArticles.length === 0) {
      const noSourceMsg = "Je n'ai trouve aucun article pertinent dans ma base documentaire pour repondre de maniere fiable a cette question. Cela peut signifier que ce texte de loi specifique n'est pas encore indexe dans Juria. Je vous recommande de consulter un avocat ou verifier directement aupres de l'AMMC / Bulletin Officiel pour les details exacts. Consultez un avocat pour tout acte juridique.";
      return new Response(JSON.stringify({ answer: noSourceMsg, citations: [], is_contract: false, deliverables: getDeliverables("default") }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ETAPE 4 : Reranking — GPT sélectionne les 5 articles les plus pertinents parmi 30
    let articles = candidateArticles.slice(0, 8);
    try {
      const candidatesSummary = candidateArticles.map((a: any, i: number) =>
        "[" + i + "] " + a.numero_article + " — " + (a.code || "Législation") + ": " + a.contenu.slice(0, 180)
      ).join(" || ");

      const rerankResult = await callOpenAI(
        "Tu es expert juridique marocain. Parmi ces articles juridiques, sélectionne les 5 indices (0 à " + (candidateArticles.length - 1) + ") des articles les PLUS PERTINENTS pour répondre à la question. Ignore les articles hors sujet même s'ils ont le même numéro. Retourne UNIQUEMENT un JSON: {\"selected\": [0, 3, 7, 12, 18]}",
        "Question: " + standaloneQuestion + " | Recherche: " + searchQuery + " | Articles: " + candidatesSummary,
        80
      );

      if (rerankResult.selected && Array.isArray(rerankResult.selected) && rerankResult.selected.length > 0) {
        const reranked = rerankResult.selected
          .filter((i: number) => i >= 0 && i < candidateArticles.length)
          .slice(0, 5)
          .map((i: number) => candidateArticles[i]);
        if (reranked.length > 0) {
          articles = reranked;
          console.log("Reranker: selected", rerankResult.selected, "from", candidateArticles.length, "candidates");
        }
      }
    } catch(e) {
      console.warn("Reranking failed, using top 8:", e);
      articles = candidateArticles.slice(0, 8);
    }

    // DEBUG: logguer les articles finaux apres reranking
    console.log("RERANKED:", JSON.stringify(articles.map((a: any) => ({ ref: a.numero_article, code: a.code }))));

    // ETAPE 5 : Construire le contexte avec métadonnées enrichies
    const context = articles.map((a: any, i: number) =>
      "[" + i + "] " + a.numero_article + " — " + (a.code || "Législation marocaine") + ": " + a.contenu
    ).join(" | ");

    // DEBUG: logguer pour diagnostiquer mémoire vs retrieval
    console.log("DEBUG_PIPELINE:", JSON.stringify({
      original_question: question,
      standalone_question: standaloneQuestion,
      search_query: searchQuery,
      code_filter: codeFilter,
      retrieved_count: articles.length,
      retrieved_refs: articles.map((a: any) => a.numero_article + " — " + a.code),
    }));

    // ETAPE 6 : Répondre avec GPT + historique + articles reranked
    // Construire la liste d'articles avec IDs pour citations robustes
    const articleIds = articles.map((a: any) => a.id);
    const articlesList = articles.map((a: any, i: number) =>
      "{id:" + a.id + ", index:" + i + ", ref:\"" + a.numero_article + " — " + (a.code || "Législation") + "\"}"
    ).join(", ");

    const questionSystem = [
      "Tu es Juria, expert juridique marocain senior avec 20 ans d'expérience.",
      "REGLE CONTEXTE STRICTE: Le dernier message de l'utilisateur peut etre une correction, precision ou restriction d'une question precedente. Si l'utilisateur restreint le sujet (ex: 'je parle de X', 'il me semble que...'), tu DOIS repondre UNIQUEMENT dans ce perimetre restreint, jamais repeter une reponse generale deja donnee. Exemple: Question initiale 'Les dividendes sont-ils obligatoires ?' puis correction 'je parle des OPCI' -> tu dois repondre specifiquement sur l'obligation de distribution des OPCI, pas redefinir ce qu'est un OPCI en general.",
      "REGLE SOURCES: Si les articles fournis ne permettent pas de repondre precisement a la question, dis-le clairement plutot que d'improviser une reponse generale basee sur des connaissances non sourcees.",
      "Tu maîtrises: COC, Code de Commerce, Code du Travail, Code de la Famille, Code Pénal, Code des Assurances, et toute la législation marocaine.",
      "RÈGLE IMPORTANTE — AMBIGUÏTÉ: Si la question contient un terme qui peut désigner plusieurs domaines juridiques différents (ex: 'courtier' peut être courtier en assurance, en bourse, ou immobilier; 'gérant' peut être SA, SARL, ou fonds de commerce), tu DOIS demander une clarification au lieu de répondre.",
      "Tu reçois des articles officiels avec leurs IDs. Utilise UNIQUEMENT les articles réellement pertinents.",
      "RÈGLE CITATIONS: Dans used_article_ids, ne mets QUE les IDs des articles que tu as réellement utilisés pour répondre. Si un article n'est pas pertinent, ne le cite pas.",
      "Réponds en 2-4 paragraphes clairs.",
      "Termine par: Consultez un avocat pour tout acte juridique.",
      "Articles disponibles: [" + articlesList + "]",
      "Retourne UNIQUEMENT un JSON: {\"answer\": \"réponse experte\", \"used_article_ids\": [123, 456], \"needs_clarification\": false, \"legal_topic\": \"courtier_assurance\"} ou autre topic parmi: courtier_assurance, assurance, travail, contrat_travail, sarl, sa, bail_commercial, bail_habitation, fonds_commerce, cheque, societe, licenciement, conge, salaire, faillite, immobilier, opci, opcvm, bourse, titrisation, capital_risque, financement_collaboratif",
    ].join(" ");

    const messages: any[] = [{ role: "system", content: questionSystem }];
    // On envoie UNIQUEMENT la question reconstruite (standalone) + les articles, pas l'historique brut en double
    // (l'historique a deja ete utilise pour reconstruire la question a l'etape 1, le renvoyer ici creerait une contradiction potentielle)
    messages.push({ role: "user", content: "Question a traiter: " + standaloneQuestion + " | Articles trouves: " + context });

    const result = await callOpenAIMessages(messages, 1200);

    // Validation des citations — ne garder que les articles dont l'ID a été fourni
    const usedIds: number[] = result.used_article_ids || [];
    const validatedCitations = usedIds
      .map((id: number) => articles.find((a: any) => a.id === id))
      .filter(Boolean);

    // Fallback sur used_indices si used_article_ids absent
    if (validatedCitations.length === 0 && result.used_indices) {
      const fallbackIndices: number[] = result.used_indices || [];
      const fallbackCitations = fallbackIndices.map((i: number) => articles[i]).filter(Boolean);
      if (orgId) {
        logQuotaUsage(orgId, "chat", 1).catch(e => console.warn("[smart-endpoint] Quota log failed:", e));
      }
      return new Response(
        JSON.stringify({ answer: result.answer || "", citations: fallbackCitations, is_contract: false, needs_clarification: result.needs_clarification || false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const legalTopic = result.legal_topic || "default";
    const deliverables = getDeliverables(legalTopic + " " + standaloneQuestion);
    if (orgId) {
      logQuotaUsage(orgId, "chat", 1).catch(e => console.warn("[smart-endpoint] Quota log failed:", e));
    }
    return new Response(
      JSON.stringify({ answer: result.answer || "", citations: validatedCitations, is_contract: false, needs_clarification: result.needs_clarification || false, deliverables: deliverables, legal_topic: legalTopic }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Edge Function error:", err);
    // Rate limit OpenAI persistant après retries : message clair + 429.
    if ((err as any)?.aiStatus === 429) {
      return new Response(JSON.stringify({
        error: "Le service d'analyse est momentanément surchargé. Patientez un instant puis réessayez.",
        code: "AI_RATE_LIMITED",
      }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Erreur serveur inattendue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
