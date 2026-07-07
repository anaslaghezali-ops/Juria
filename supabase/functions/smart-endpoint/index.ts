import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("plan, questions_used, questions_limit, trial_ends_at")
      .eq("id", user.id)
      .single();

    if (!profile) {
      await supabaseAdmin.from("user_profiles").insert({
        id: user.id, plan: "trial", questions_used: 0, questions_limit: 20,
        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    const currentProfile = profile || { plan: "trial", questions_used: 0, questions_limit: 20 };

    if (currentProfile.questions_used >= currentProfile.questions_limit) {
      return new Response(JSON.stringify({ error: "Quota atteint.", code: "QUOTA_EXCEEDED" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { question, contract_to_analyze, mode, history, document_context, conversation_context } = body;
    const conversationHistory: any[] = history || [];

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

    const incrementQuota = async () => {
      await supabaseAdmin
        .from("user_profiles")
        .update({ questions_used: currentProfile.questions_used + 1 })
        .eq("id", user.id);
    };

    const callOpenAI = async (systemPrompt: string, userContent: string, maxTokens: number, jsonMode = true) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          max_tokens: maxTokens,
          temperature: 0.1,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) throw new Error("OpenAI error: " + res.status);
      const data = await res.json();
      const text = data.choices[0].message.content;
      return jsonMode ? JSON.parse(text) : text;
    };

    const callOpenAIMessages = async (messages: any[], maxTokens: number, jsonMode = true) => {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          max_tokens: maxTokens,
          temperature: 0.1,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) throw new Error("OpenAI error: " + res.status);
      const data = await res.json();
      const text = data.choices[0].message.content;
      return jsonMode ? JSON.parse(text) : text;
    };

    const vectorSearch = async (query: string, count = 30, codes: string[] = []) => {
      const embRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
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
      await incrementQuota();
      return new Response(JSON.stringify({ answer: result.answer || "", citations: [], is_contract: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- MODE QUESTION SUR DOCUMENT ----
    if (mode === "document_question" && document_context) {
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
      await incrementQuota();
      return new Response(
        JSON.stringify({ answer: docResult.answer || "", citations: [], is_contract: false, needs_clarification: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- MODE COMPARAISON DE CONTRATS ----
    if (mode === "compare" && document_context) {
      const parts = document_context.split("---");
      const v1 = parts[0] ? parts[0].replace("CONTRAT V1:", "").trim() : "";
      const v2 = parts[1] ? parts[1].replace("CONTRAT V2:", "").trim() : "";

      const compareSystem = [
        "Tu es expert juridique marocain. Compare ces deux versions de contrat.",
        "Identifie TOUTES les differences: clauses modifiees, ajoutees, supprimees.",
        "Retourne UNIQUEMENT un JSON valide sans markdown ni explication:",
        '{"summary": "resume court", "changes": [{"type": "modification", "clause": "nom de la clause", "v1": "texte original", "v2": "nouveau texte", "impact": "majeur"}]}',
        "Types possibles UNIQUEMENT: ajout (nouvelle clause), suppression (clause supprimee), modification (clause modifiee). Impact: majeur, mineur, neutre. N utilise PAS addition, added, deleted, changed.",
        "Si aucune difference: changes = tableau vide.",
      ].join(" ");

      const compareMessages: any[] = [
        { role: "system", content: compareSystem },
        { role: "user", content: "CONTRAT V1 (original):\n" + v1.slice(0, 4000) + "\n\nCONTRAT V2 (modifie):\n" + v2.slice(0, 4000) }
      ];

      const rawResult = await callOpenAIMessages(compareMessages, 1500);
      let compareData = { summary: "", changes: [] };
      try {
        const answer = rawResult.answer || JSON.stringify(rawResult);
        const clean = answer.replace(/```json/g, "").replace(/```/g, "").trim();
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          compareData = JSON.parse(clean.slice(start, end + 1));
        }
      } catch(e) {
        compareData = { summary: rawResult.answer || "Erreur parsing", changes: [] };
      }

      await incrementQuota();
      return new Response(
        JSON.stringify(compareData),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- MODE ANALYSE DE CONTRAT ----
    if (mode === "analyze" && contract_to_analyze) {
      const articles = await vectorSearch(question, 6);
      const articlesContext = articles.length > 0
        ? articles.map((a: any) => a.numero_article + " : " + a.contenu).join(" === ")
        : "";
      const analyzeSystem = [
        "Tu es Juria, expert juridique marocain senior specialise en droit des contrats.",
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
        "Articles de reference: " + articlesContext,
        "Retourne UNIQUEMENT un JSON: {contract_type: string, score: number, summary: string, issues: [{paragraph_id: number, severity: string, clause: string, problem: string, suggestion: string}], missing_clauses: [string]}. paragraph_id = le numero entre crochets [N] du paragraphe concerne dans le contrat fourni.",
      ].join(" ");
      const contractText = "Contrat: " + contract_to_analyze.slice(0, 8000);
      const analysis = await callOpenAI(analyzeSystem, contractText, 1500);
      await incrementQuota();
      return new Response(JSON.stringify(analysis), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- MODE GENERATION DE CONTRAT ----
    const contractKeywords = ["rédige moi", "rédiger un contrat", "génère un contrat", "créer un contrat", "faire un contrat", "écris un contrat", "modèle de contrat"];
    const isContract = contractKeywords.some(kw => question.toLowerCase().includes(kw));

    if (isContract) {
      const articles = await vectorSearch(question, 5);
      const articlesContext = articles.map((a: any) => a.numero_article + " : " + a.contenu).join(" === ");
      const contractSystem = "Tu es Juria, expert juridique marocain. Rédige un contrat complet conforme au droit marocain. Utilise [INFORMATION À COMPLÉTER] pour les champs variables. Structure: EN-TÊTE, PARTIES, PRÉAMBULE, OBJET, DURÉE, CONDITIONS FINANCIÈRES, OBLIGATIONS, RÉSILIATION, LITIGES, SIGNATURES. Articles: " + articlesContext + ". Retourne UNIQUEMENT un JSON: {\"answer\": \"contrat complet\", \"used_indices\": [], \"based_on_articles\": false}";
      const result = await callOpenAI(contractSystem, "Demande: " + question, 2000);
      await incrementQuota();
      return new Response(JSON.stringify({ answer: result.answer || "", citations: [], is_contract: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- MODE LIVRABLE (génération de document) ----
    if (mode === "deliverable") {
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
      await incrementQuota();
      return new Response(
        JSON.stringify({ answer: delivResult.answer || "", citations: [], is_contract: false, needs_clarification: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- MODE QUESTION JURIDIQUE ----
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

    // ETAPE 2 : Classifier juridique — identifier les codes pertinents
    let codeFilter: string[] = [];
    try {
      const classifierResult = await callOpenAI(
        "Tu es expert juridique marocain. Identifie les codes juridiques pertinents pour la question. Retourne UNIQUEMENT un JSON avec: codes (noms des codes parmi: Code des Assurances Loi 17-99 / Code de Commerce / Code du Travail Loi 65-99 / Code des Obligations et Contrats / Legislation commerciale) et confidence (0 a 1). Si general ou multi-codes, confidence < 0.7.",
        "Question: " + standaloneQuestion + " | Recherche: " + searchQuery,
        100
      );

      if (classifierResult.confidence >= 0.7 && classifierResult.codes && classifierResult.codes.length > 0) {
        console.log("Classifier (DESACTIVE temporairement):", classifierResult.codes, "confidence:", classifierResult.confidence);
        // codeFilter = classifierResult.codes; // DESACTIVE le 2026-06-21 pour diagnostiquer pourquoi certains articles (ex: Loi 70-14 OPCI) ne remontent pas. Le classifier ne connait que les codes traditionnels (Commerce, Travail, Assurances...) et exclut a tort des lois specialisees (OPCI, marche des capitaux, etc.) absentes de sa liste.
      }
    } catch(e) {
      console.warn("Classifier failed, searching all codes:", e);
    }

    // ETAPE 3 : Recherche hybride — Top 30 candidats (filtrée par code si classifier confiant)
    const candidateArticles = await vectorSearch(searchQuery, 30, codeFilter);

    // DEBUG: logguer le TOP30 brut avant reranking pour diagnostiquer si le retrieval trouve les bons articles
    console.log("TOP30:", JSON.stringify(candidateArticles.map((a: any) => ({ ref: a.numero_article, code: a.code }))));

    if (!candidateArticles || candidateArticles.length === 0) {
      const noSourceMsg = "Je n'ai trouve aucun article pertinent dans ma base documentaire pour repondre de maniere fiable a cette question. Cela peut signifier que ce texte de loi specifique n'est pas encore indexe dans Juria. Je vous recommande de consulter un avocat ou verifier directement aupres de l'AMMC / Bulletin Officiel pour les details exacts. Consultez un avocat pour tout acte juridique.";
      await incrementQuota();
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
      "REGLE OBLIGATOIRE LIVRABLES: Le champ answer doit TOUJOURS se terminer par une ligne vide puis: 'Si vous souhaitez, je peux vous preparer : 1. [livrable concret] 2. [livrable concret] 3. [livrable concret]'. Adapte les 3 livrables au sujet specifique de la question. Ne jamais oublier cette section finale.",
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
      await incrementQuota();
      return new Response(
        JSON.stringify({ answer: result.answer || "", citations: fallbackCitations, is_contract: false, needs_clarification: result.needs_clarification || false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const legalTopic = result.legal_topic || "default";
    const deliverables = getDeliverables(legalTopic + " " + standaloneQuestion);
    await incrementQuota();
    return new Response(
      JSON.stringify({ answer: result.answer || "", citations: validatedCitations, is_contract: false, needs_clarification: result.needs_clarification || false, deliverables: deliverables, legal_topic: legalTopic }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Edge Function error:", err);
    return new Response(JSON.stringify({ error: "Erreur serveur inattendue" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
