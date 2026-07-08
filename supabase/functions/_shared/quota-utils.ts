import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export const supabase = createClient(supabaseUrl!, supabaseKey!);

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: number;
  breakdown?: Record<string, number>;
}

/**
 * Check if organization has quota remaining for an operation
 */
export async function checkOrgQuota(
  orgId: string,
  operationType: string,
  quantity: number = 1
): Promise<QuotaCheckResult> {
  try {
    // Get org quota
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("monthly_quota")
      .eq("id", orgId)
      .single();

    if (orgError || !org) {
      return { allowed: false, reason: "Organization not found" };
    }

    const totalQuota = org.monthly_quota;
    if (totalQuota === -1) {
      // Unlimited
      return { allowed: true, remaining: -1 };
    }

    // Get operation cost
    const { data: opCost, error: opError } = await supabase
      .from("operation_costs")
      .select("base_cost")
      .eq("operation_type", operationType)
      .single();

    if (opError || !opCost) {
      return { allowed: false, reason: `Unknown operation type: ${operationType}` };
    }

    const costThisOp = opCost.base_cost * quantity;

    // Calculate current usage this month
    const monthStart = getMonthStart();
    const { data: usage, error: usageError } = await supabase
      .from("organization_usage")
      .select("operation_type, total_cost")
      .eq("org_id", orgId)
      .eq("month", formatDate(monthStart));

    if (usageError && usageError.code !== "PGRST116") {
      return { allowed: false, reason: `Database error: ${usageError.message}` };
    }

    const breakdown: Record<string, number> = {};
    let totalUsed = 0;

    (usage || []).forEach((row: any) => {
      breakdown[row.operation_type] = (breakdown[row.operation_type] || 0) + row.total_cost;
      totalUsed += row.total_cost;
    });

    const remaining = totalQuota - totalUsed;

    if (remaining < costThisOp) {
      return {
        allowed: false,
        reason: `Insufficient quota. Need ${costThisOp} credits, have ${remaining}`,
        remaining: Math.max(0, remaining),
        breakdown,
      };
    }

    return {
      allowed: true,
      remaining: remaining - costThisOp,
      breakdown,
    };
  } catch (error) {
    console.error("Error in checkOrgQuota:", error);
    return { allowed: false, reason: `Internal error: ${error.message}` };
  }
}

/**
 * Log credit consumption for an operation
 */
export async function logQuotaUsage(
  orgId: string,
  operationType: string,
  quantity: number = 1,
  description?: string
): Promise<boolean> {
  try {
    // Get operation cost
    const { data: opCost, error: opError } = await supabase
      .from("operation_costs")
      .select("base_cost")
      .eq("operation_type", operationType)
      .single();

    if (opError || !opCost) {
      console.error(`Unknown operation type: ${operationType}`);
      return false;
    }

    const totalCost = opCost.base_cost * quantity;
    const monthStart = getMonthStart();
    const monthStr = formatDate(monthStart);

    // Upsert: increment or create
    const { error: upsertError } = await supabase
      .from("organization_usage")
      .upsert(
        {
          org_id: orgId,
          month: monthStr,
          operation_type: operationType,
          cost_per_unit: opCost.base_cost,
          count: quantity,
          total_cost: totalCost,
          description,
        },
        { onConflict: "org_id,month,operation_type" }
      );

    if (upsertError) {
      console.error("Error logging quota usage:", upsertError);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error in logQuotaUsage:", error);
    return false;
  }
}
