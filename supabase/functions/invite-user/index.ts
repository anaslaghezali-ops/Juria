import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const {
      email,
      firstName,
      lastName,
      role,
      orgId,
      invitedBy,
    } = await req.json();

    // Validate inputs
    if (!email || !orgId || !invitedBy) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, orgId, invitedBy" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceKey) {
      console.error("Missing env vars:", { supabaseUrl: !!supabaseUrl, serviceKey: !!serviceKey });
      throw new Error("Missing Supabase configuration (env vars not set in Edge Function)");
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Temporary password
    const tempPassword = `Juria-${Math.random().toString(36).slice(2, 10)}!`;

    console.log("[invite-user] Creating user:", { email, org_id: orgId });

    const { data: newUser, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        user_metadata: {
          full_name: `${firstName || ""} ${lastName || ""}`.trim(),
          org_id: orgId,
        },
        email_confirm: true,
      });

    if (createError) {
      console.error("[invite-user] createUser error:", createError);
      throw createError;
    }

    const userId = newUser.user.id;
    console.log("[invite-user] User created:", userId);

    // Check if already a member of this organization
    const { data: existingMember } = await supabase
      .from("organization_users")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingMember) {
      return new Response(
        JSON.stringify({ error: "Cet utilisateur fait déjà partie de l'organisation" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Add user to organization
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
      .single();

    if (addError) {
      throw addError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "User invited successfully",
        userId,
        member,
        tempPassword, // null if the user already existed
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
