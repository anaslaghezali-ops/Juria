import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
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
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Check if user already exists
    const { data: existingUsers, error: listError } =
      await supabase.auth.admin.listUsers();

    if (listError) {
      throw listError;
    }

    let userId = existingUsers?.users?.find((u) => u.email === email)?.id;

    // If user doesn't exist, create them
    if (!userId) {
      const { data: newUser, error: createError } =
        await supabase.auth.admin.createUser({
          email,
          user_metadata: {
            full_name: `${firstName || ""} ${lastName || ""}`.trim(),
            org_id: orgId,
          },
          email_confirm: false,
        });

      if (createError) {
        throw createError;
      }

      userId = newUser.user.id;
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
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
