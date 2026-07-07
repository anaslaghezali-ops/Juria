import { createClient } from "supabase";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Initialize Supabase client with service role key for server-side operations
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface RequestPayload {
  operation: "read" | "update" | "delete" | "create";
  table: string;
  data?: Record<string, any>;
  filters?: Record<string, any>;
  orgId: string;
  userId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: Authentication & Authorization
// ═══════════════════════════════════════════════════════════════════════════

async function authenticateRequest(req: Request): Promise<{
  user_id: string;
  org_id: string;
}> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new Error("Missing authorization header");
  }

  // Extract JWT from "Bearer <token>"
  const token = authHeader.split(" ")[1];
  if (!token) {
    throw new Error("Invalid authorization format");
  }

  // Verify JWT with Supabase
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Unauthorized: Invalid token");
  }

  // Get user's organization from profiles table
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("User profile not found");
  }

  return {
    user_id: data.user.id,
    org_id: profile.organization_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION: Verify organization access
// ═══════════════════════════════════════════════════════════════════════════

function validateOrgAccess(requestOrgId: string, userOrgId: string): void {
  if (requestOrgId !== userOrgId) {
    throw new Error("Forbidden: Organization mismatch");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS: Database operations
// ═══════════════════════════════════════════════════════════════════════════

async function handleUpdate(
  table: string,
  payload: RequestPayload
): Promise<any> {
  const { data, filters, orgId } = payload;

  if (!data || !filters) {
    throw new Error("Missing data or filters for update operation");
  }

  // Always enforce organization_id in filters
  const secureFilters = {
    ...filters,
    organization_id: orgId,
  };

  // Build query dynamically
  let query = supabase.from(table).update(data);

  // Apply all filters
  Object.entries(secureFilters).forEach(([key, value]) => {
    query = query.eq(key, value);
  });

  const { data: result, error } = await query.select();

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return result;
}

async function handleRead(
  table: string,
  payload: RequestPayload
): Promise<any> {
  const { filters, orgId } = payload;

  // Always enforce organization_id in filters
  const secureFilters = {
    ...filters,
    organization_id: orgId,
  };

  let query = supabase.from(table).select("*");

  // Apply all filters
  Object.entries(secureFilters).forEach(([key, value]) => {
    query = query.eq(key, value);
  });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data;
}

async function handleDelete(
  table: string,
  payload: RequestPayload
): Promise<any> {
  const { filters, orgId } = payload;

  // Always enforce organization_id in filters
  const secureFilters = {
    ...filters,
    organization_id: orgId,
  };

  let query = supabase.from(table).delete();

  // Apply all filters
  Object.entries(secureFilters).forEach(([key, value]) => {
    query = query.eq(key, value);
  });

  const { data, error } = await query.select();

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data;
}

async function handleCreate(
  table: string,
  payload: RequestPayload
): Promise<any> {
  const { data, orgId } = payload;

  if (!data) {
    throw new Error("Missing data for create operation");
  }

  // Always add organization_id to new records
  const secureData = {
    ...data,
    organization_id: orgId,
  };

  const { data: result, error } = await supabase
    .from(table)
    .insert([secureData])
    .select();

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  try {
    // Only allow POST and OPTIONS
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    // Authenticate and get user info
    const auth = await authenticateRequest(req);

    // Parse request body
    const payload: RequestPayload = await req.json();

    // Validate organization access
    validateOrgAccess(payload.orgId, auth.org_id);

    // Route to appropriate handler
    let result;
    switch (payload.operation) {
      case "read":
        result = await handleRead(payload.table, payload);
        break;
      case "update":
        result = await handleUpdate(payload.table, payload);
        break;
      case "delete":
        result = await handleDelete(payload.table, payload);
        break;
      case "create":
        result = await handleCreate(payload.table, payload);
        break;
      default:
        return new Response(JSON.stringify({ error: "Unknown operation" }), {
          status: 400,
          headers: corsHeaders,
        });
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Error:", error.message);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: error.message.includes("Unauthorized") ? 401 :
        error.message.includes("Forbidden") ? 403 : 400,
        headers: corsHeaders,
      }
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CORS HEADERS
// ═══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};
