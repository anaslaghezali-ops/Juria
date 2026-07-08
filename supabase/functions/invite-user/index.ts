import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  try {
    const { email, firstName, lastName, role, orgId, invitedBy } = await req.json()

    if (!email || !orgId || !invitedBy) {
      return new Response(
        JSON.stringify({ error: "Missing email, orgId, or invitedBy" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      throw new Error(`Missing config: url=${!!supabaseUrl}, key=${!!serviceKey}`)
    }

    // Create user via HTTP API directly (bypass SDK issues)
    const tempPassword = `Juria-${Math.random().toString(36).slice(2, 10)}!`
    const fullName = `${firstName || ""} ${lastName || ""}`.trim()

    const payload = {
      email,
      password: tempPassword,
      user_metadata: {
        full_name: fullName,
        org_id: orgId,
      },
      email_confirm: true,
    }

    console.log("[invite-user] Payload:", JSON.stringify(payload))

    const createUserRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
      },
      body: JSON.stringify(payload),
    })

    const createUserData = await createUserRes.json()

    console.log("[invite-user] Response status:", createUserRes.status)
    console.log("[invite-user] Response data:", JSON.stringify(createUserData))

    if (!createUserRes.ok) {
      throw new Error(`HTTP ${createUserRes.status}: ${JSON.stringify(createUserData)}`)
    }

    const userId = createUserData.id

    // Now add to organization_users via SDK
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: member, error: addError } = await supabase
      .from("organization_users")
      .insert({
        organization_id: orgId,
        user_id: userId,
        email,
        first_name: firstName || null,
        last_name: lastName || null,
        role: role || "member",
        invited_by: invitedBy,
        invited_at: new Date().toISOString(),
        is_active: true,
      })
      .select()
      .single()

    if (addError) {
      throw new Error(`Add member failed: ${JSON.stringify(addError)}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Utilisateur créé avec succès",
        userId,
        member,
        tempPassword,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error"
    console.error("Error:", errorMsg)
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
