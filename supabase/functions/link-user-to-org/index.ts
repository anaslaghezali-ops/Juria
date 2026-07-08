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
 * Two paths:
 *   1. INVITED user  — a pre-invitation row exists in organization_users
 *                      (user_id IS NULL, email matches). We claim it by
 *                      setting user_id.
 *   2. ORGANIC signup — no pre-invitation exists. We create a brand-new
 *                       organization and link the user as its owner so the
 *                       app never ends up with an authenticated-but-orgless
 *                       user (which previously caused a PGRST116 / 406 in
 *                       getCurrentOrganization()).
 *
 * This function is idempotent: if the user already has a membership row it
 * is a no-op.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  try {
    const { userId, email, name } = await req.json()

    if (!userId || !email) {
      return new Response(
        JSON.stringify({ error: "Missing userId or email" }),
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

    // ── Path 1: claim a pre-invitation ──────────────────────────────────
    const { data: invited, error: inviteError } = await supabase
      .from("organization_users")
      .update({ user_id: userId })
      .eq("email", email)
      .is("user_id", null)
      .select("id, organization_id")

    if (inviteError) throw new Error(JSON.stringify(inviteError))

    if (invited && invited.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          type: "invited",
          organizationId: invited[0].organization_id,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // ── Path 2: organic signup → create a personal organization ─────────
    const displayName = (name && name.trim()) || email.split("@")[0]

    // Collision-safe slug: base derived from the email local-part plus a
    // short random suffix, since organizations.slug is UNIQUE.
    const base = email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
    const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .insert({
        name: displayName,
        slug,
        plan: "trial",
        max_users: 1,
        country: "MA",
      })
      .select("id")
      .single()

    if (orgError) throw new Error(JSON.stringify(orgError))

    const [firstName, ...rest] = displayName.split(" ")
    const lastName = rest.join(" ") || null

    const { error: memberError } = await supabase
      .from("organization_users")
      .insert({
        organization_id: org.id,
        user_id: userId,
        email,
        first_name: firstName || null,
        last_name: lastName,
        role: "owner",
        is_active: true,
      })

    if (memberError) throw new Error(JSON.stringify(memberError))

    return new Response(
      JSON.stringify({
        success: true,
        type: "created",
        organizationId: org.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
