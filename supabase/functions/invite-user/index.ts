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

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Create the user
    const tempPassword = `Juria-${Math.random().toString(36).slice(2, 10)}!`

    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      user_metadata: {
        full_name: `${firstName || ""} ${lastName || ""}`.trim(),
        org_id: orgId,
      },
      email_confirm: true,
    })

    if (createError) {
      throw new Error(`Create user failed: ${JSON.stringify(createError)}`)
    }

    const userId = newUser.user.id

    // Add to organization
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
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
