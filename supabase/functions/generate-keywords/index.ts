import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { authenticateRequest, errorResponse } from "../_shared/auth.ts";

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));

  // Handle CORS preflight
  const preflightResponse = handleCorsPreFlight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // ✅ AUTHENTICATION REQUIRED
    await authenticateRequest(req);
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "Clé OpenAI manquante" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Récupérer les articles sans keywords_enriched (batch de 20)
    const { data: articles, error } = await supabaseAdmin
      .from("articles_juridiques_legacy")
      .select("id, code, numero_article, contenu, book, title, mots_cles")
      .is("keywords_enriched", null)
      .limit(20);

    if (error) throw error;
    if (!articles || articles.length === 0) {
      return new Response(JSON.stringify({ message: "Tous les mots-clés sont générés !", total: 0, done: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Générer les mots-clés pour chaque article via GPT
    let updated = 0;
    for (const article of articles) {
      try {
        const context = [
          article.code || "",
          article.book || "",
          article.title || "",
          article.numero_article || "",
          (article.contenu || "").slice(0, 600),
        ].filter(Boolean).join(" — ");

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + openaiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "Tu es expert juridique marocain. Pour cet article de loi, génère 15-20 mots-clés et synonymes en français qui permettraient à un utilisateur de trouver cet article. Inclus: termes juridiques exacts, synonymes courants, concepts liés, noms d'institutions (ACAPS, Bank Al-Maghrib, etc.), types de contrats ou procédures mentionnés. Réponds UNIQUEMENT avec les mots séparés par des espaces, sans ponctuation ni explication.",
              },
              {
                role: "user",
                content: context,
              },
            ],
            max_tokens: 150,
            temperature: 0,
          }),
        });

        if (!res.ok) continue;
        const data = await res.json();
        const keywords = data.choices[0].message.content.trim();

        // Sauvegarder les mots-clés
        await supabaseAdmin
          .from("articles_juridiques_legacy")
          .update({ keywords_enriched: keywords })
          .eq("id", article.id);

        updated++;
      } catch(e) {
        console.error("Error processing article", article.id, e);
      }
    }

    // Mettre à jour le search_vector pour les articles traités
    await supabaseAdmin.rpc("refresh_search_vectors");

    // Compter combien il en reste
    const { count } = await supabaseAdmin
      .from("articles_juridiques_legacy")
      .select("id", { count: "exact", head: true })
      .is("keywords_enriched", null);

    return new Response(JSON.stringify({
      message: updated + " articles enrichis",
      remaining: count || 0,
      done: (count || 0) === 0,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
