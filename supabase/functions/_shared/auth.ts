import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthContext {
  userId: string;
  user: any;
  profile: any;
}

/**
 * Authenticate request and return user context
 * Throws 401 if invalid token
 */
export async function authenticateRequest(
  req: Request
): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw { status: 401, message: "Missing or invalid authorization header" };
  }

  const token = authHeader.slice(7);
  if (!token) {
    throw { status: 401, message: "Invalid token format" };
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    throw { status: 401, message: "Invalid or expired token" };
  }

  // Get user profile
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return {
    userId: user.id,
    user,
    profile,
  };
}

/**
 * Extract and validate JWT token from Authorization header
 */
export function extractToken(req: Request): string {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw { status: 401, message: "Missing or invalid authorization header" };
  }
  return authHeader.slice(7);
}

/**
 * Create secure response with proper error handling
 */
export function errorResponse(status: number, message: string, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
