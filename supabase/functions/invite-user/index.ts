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
      throw new Error("Missing Supabase configuration")
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Simply add to organization_users with user_id = null
    // User will create their own account later via auth.html
    const { data: member, error: addError } = await supabase
      .from("organization_users")
      .insert({
        organization_id: orgId,
        user_id: null,
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
      throw new Error(JSON.stringify(addError))
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invitation créée. L'utilisateur devra créer son compte.",
        member,
        inviteLink: "/auth.html?email=" + encodeURIComponent(email),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error"
    console.error("[invite-user] Error:", errorMsg)
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
