import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { checkOrgQuota, getOrgIdForUser } from "../_shared/quota-utils.ts";

/**
 * JURIA — get-remaining-quota
 * État du quota crédits de l'organisation de l'utilisateur courant.
 * Lecture seule : ne consomme rien.
 */
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));
  const preflight = handleCorsPreFlight(req);
  if (preflight) return preflight;

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
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Session invalide" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = await getOrgIdForUser(user.id);
    const quota = await checkOrgQuota(orgId, "synthesis", 0);

    return new Response(JSON.stringify({ org_id: orgId, ...quota }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const status = (error as { status?: number })?.status || 500;
    const message = (error as { message?: string })?.message || "Erreur interne";
    console.error("[get-remaining-quota]", message);
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
