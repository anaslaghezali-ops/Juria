import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

/**
 * Provision organization membership for a freshly-created auth user.
 *
 * Juria est SUR INVITATION UNIQUEMENT : les organisations sont créées par le
 * superadmin (back-office) ; leurs membres par un admin d'organisation
 * (invite-user). Il n'existe AUCUN signup organique.
 *
 *   - mode "check" ({ email, check: true }) : l'email a-t-il une invitation
 *     en attente ? Appelé par auth.html AVANT de créer le compte auth.
 *   - mode claim ({ userId, email })        : réclame l'invitation en
 *     attente (user_id IS NULL, email égal sans tenir compte de la casse —
 *     les claviers mobiles capitalisent). Sans invitation → 403 NOT_INVITED,
 *     aucune organisation n'est créée.
 *
 * Idempotent : si l'utilisateur a déjà une adhésion, no-op.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  try {
    const { userId, email, check } = await req.json()

    const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : ""
    if (!normalizedEmail) {
      return new Response(
        JSON.stringify({ error: "Missing email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Missing Supabase configuration")
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Mode CHECK : invitation en attente pour cet email ? ─────────────
    if (check) {
      const { data: pending, error: checkError } = await supabase
        .from("organization_users")
        .select("id")
        .ilike("email", normalizedEmail)
        .is("user_id", null)
        .limit(1)
        .maybeSingle()

      if (checkError) throw new Error(JSON.stringify(checkError))

      return new Response(
        JSON.stringify({ invited: !!pending }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Missing userId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Idempotency guard: already a member? ────────────────────────────
    const { data: existing, error: existingError } = await supabase
      .from("organization_users")
      .select("id, organization_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle()

    if (existingError) throw new Error(JSON.stringify(existingError))

    if (existing?.organization_id) {
      return new Response(
        JSON.stringify({
          success: true,
          type: "already_member",
          organizationId: existing.organization_id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Claim de l'invitation (insensible à la casse : les claviers
    //    mobiles capitalisent la première lettre de l'email) ──────────────
    const { data: pending, error: pendingError } = await supabase
      .from("organization_users")
      .select("id")
      .ilike("email", normalizedEmail)
      .is("user_id", null)

    if (pendingError) throw new Error(JSON.stringify(pendingError))

    if (pending && pending.length > 0) {
      const { data: claimed, error: claimError } = await supabase
        .from("organization_users")
        .update({ user_id: userId, email: normalizedEmail })
        .in("id", pending.map((p) => p.id))
        .select("id, organization_id")

      if (claimError) throw new Error(JSON.stringify(claimError))

      return new Response(
        JSON.stringify({
          success: true,
          type: "invited",
          organizationId: claimed![0].organization_id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Pas d'invitation : Juria est sur invitation uniquement. On ne
    //    crée JAMAIS d'organisation ici. ──────────────────────────────────
    return new Response(
      JSON.stringify({
        error: "Aucune invitation trouvée pour cet email. Les comptes Juria sont créés sur invitation par votre organisation.",
        code: "NOT_INVITED",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error"
    console.error("[link-user-to-org] Error:", errorMsg)
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
