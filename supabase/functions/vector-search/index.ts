import { getCorsHeaders, handleCorsPreFlight } from '../_shared/cors.ts';
import { authenticateRequest, errorResponse } from '../_shared/auth.ts';

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

    const body = await req.json();
    const { query } = body;

    // ✅ INPUT VALIDATION
    if (!query || typeof query !== "string") {
      return errorResponse(400, "Query is required", corsHeaders);
    }
    if (query.length > 2000) {
      return errorResponse(400, "Query is too long (max 2000 chars)", corsHeaders);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "Clé OpenAI manquante" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? ""
    );

    // Générer l'embedding de la question
    const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + openaiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query,
      }),
    });

    if (!embeddingRes.ok) throw new Error("OpenAI embedding error");
    const embeddingData = await embeddingRes.json();
    const queryEmbedding = embeddingData.data[0].embedding;

    // Recherche vectorielle via RPC
    const { data: articles, error } = await supabaseAdmin.rpc("search_articles", {
      query_embedding: queryEmbedding,
      match_count: 8,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ articles: articles || [] }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Vector search error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
