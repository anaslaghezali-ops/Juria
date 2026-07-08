import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl!, supabaseKey!);

interface QuotaResponse {
  org_id: string;
  month: string;
  total_quota: number;
  used_credits: number;
  remaining_credits: number;
  is_unlimited: boolean;
  breakdown: Record<string, number>;
  error?: string;
}

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export default async (req: Request): Promise<Response> => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
        },
      });
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract JWT and verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: user, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get user's organization
    const { data: userData, error: userDataError } = await supabase
      .from("users")
      .select("organization_id")
      .eq("id", user.user.id)
      .single();

    if (userDataError || !userData) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const orgId = userData.organization_id;

    // Get organization quota
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("monthly_quota")
      .eq("id", orgId)
      .single();

    if (orgError || !org) {
      return new Response(JSON.stringify({ error: "Organization not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const totalQuota = org.monthly_quota;
    const isUnlimited = totalQuota === -1;

    if (isUnlimited) {
      return new Response(
        JSON.stringify({
          org_id: orgId,
          month: formatDate(getMonthStart()),
          total_quota: -1,
          used_credits: 0,
          remaining_credits: -1,
          is_unlimited: true,
          breakdown: {},
        } as QuotaResponse),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Calculate usage this month
    const monthStart = getMonthStart();
    const { data: usage, error: usageError } = await supabase
      .from("organization_usage")
      .select("operation_type, total_cost")
      .eq("org_id", orgId)
      .eq("month", formatDate(monthStart));

    if (usageError && usageError.code !== "PGRST116") {
      // PGRST116 = no rows found (expected if first month)
      return new Response(
        JSON.stringify({ error: `Database error: ${usageError.message}` }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Aggregate by operation type and sum
    const breakdown: Record<string, number> = {};
    let totalUsed = 0;

    (usage || []).forEach((row: any) => {
      const type = row.operation_type;
      const cost = row.total_cost;
      breakdown[type] = (breakdown[type] || 0) + cost;
      totalUsed += cost;
    });

    const remaining = totalQuota - totalUsed;

    const response: QuotaResponse = {
      org_id: orgId,
      month: formatDate(monthStart),
      total_quota: totalQuota,
      used_credits: Math.round(totalUsed * 100) / 100,
      remaining_credits: Math.max(0, Math.round(remaining * 100) / 100),
      is_unlimited: false,
      breakdown,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Error in get-remaining-quota:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
