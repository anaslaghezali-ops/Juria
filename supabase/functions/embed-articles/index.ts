import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { authenticateRequest, errorResponse } from "../_shared/auth.ts";

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

    // Récupérer les articles sans embedding (par batch de 50)
    const { data: articles, error } = await supabaseAdmin
      .from("articles_juridiques")
      .select("id, numero_article, contenu, code, book, title, chapter")
      .is("embedding", null)
      .limit(50);

    if (error) throw error;
    if (!articles || articles.length === 0) {
      return new Response(JSON.stringify({ message: "Tous les embeddings sont générés !", total: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Générer les embeddings via OpenAI avec contexte enrichi
    const texts = articles.map((a: any) => {
      const parts = [];
      if (a.code) parts.push(a.code);
      if (a.book) parts.push(a.book);
      if (a.title) parts.push(a.title);
      if (a.chapter) parts.push(a.chapter);
      parts.push(a.numero_article || "");
      parts.push((a.contenu || "").slice(0, 500));
      return parts.join(" — ");
    });

    const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + openaiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!embeddingRes.ok) {
      const err = await embeddingRes.json();
      throw new Error("OpenAI embedding error: " + JSON.stringify(err));
    }

    const embeddingData = await embeddingRes.json();
    const embeddings = embeddingData.data;

    // Sauvegarder les embeddings dans Supabase
    let updated = 0;
    for (let i = 0; i < articles.length; i++) {
      const { error: updateError } = await supabaseAdmin
        .from("articles_juridiques")
        .update({ embedding: embeddings[i].embedding })
        .eq("id", articles[i].id);

      if (!updateError) updated++;
    }

    // Compter combien il en reste
    const { count } = await supabaseAdmin
      .from("articles_juridiques")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    return new Response(JSON.stringify({
      message: updated + " embeddings générés",
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
