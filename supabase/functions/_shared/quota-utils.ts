import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.0";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY");

export const supabase = createClient(supabaseUrl!, supabaseKey!);

function getMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().split("T")[0];
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  total_quota: number;
  used_credits: number;
  remaining_credits: number;   // -1 = illimité
  is_unlimited: boolean;
  breakdown: Record<string, number>;
}

/**
 * Organisation active d'un utilisateur (le lien passe par organization_users).
 * Throw { status, message } si aucune organisation active.
 */
export async function getOrgIdForUser(userId: string): Promise<string> {
  const { data: membership, error } = await supabase
    .from("organization_users")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !membership?.organization_id) {
    throw { status: 403, message: "Aucune organisation active" };
  }
  return membership.organization_id;
}

/**
 * Vérifie que l'organisation dispose d'assez de crédits pour une opération.
 * quantity=0 → lecture seule (état du quota sans consommer).
 */
export async function checkOrgQuota(
  orgId: string,
  operationType: string,
  quantity = 1,
): Promise<QuotaCheckResult> {
  const base: QuotaCheckResult = {
    allowed: true,
    total_quota: 0,
    used_credits: 0,
    remaining_credits: 0,
    is_unlimited: false,
    breakdown: {},
  };

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("monthly_quota")
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    return { ...base, allowed: false, reason: "Organisation introuvable" };
  }

  const totalQuota = org.monthly_quota ?? 1000;
  if (totalQuota === -1) {
    return { ...base, total_quota: -1, remaining_credits: -1, is_unlimited: true };
  }
  base.total_quota = totalQuota;

  const { data: opCost, error: opError } = await supabase
    .from("operation_costs")
    .select("base_cost")
    .eq("operation_type", operationType)
    .single();

  if (opError || !opCost) {
    return { ...base, allowed: false, reason: `Type d'opération inconnu : ${operationType}` };
  }

  const { data: usage, error: usageError } = await supabase
    .from("organization_usage")
    .select("operation_type, total_cost")
    .eq("org_id", orgId)
    .eq("month", getMonthStart());

  if (usageError) {
    return { ...base, allowed: false, reason: `Erreur base : ${usageError.message}` };
  }

  let used = 0;
  for (const row of usage || []) {
    base.breakdown[row.operation_type] = (base.breakdown[row.operation_type] || 0) + row.total_cost;
    used += row.total_cost;
  }

  const costThisOp = opCost.base_cost * quantity;
  const remaining = totalQuota - used;

  base.used_credits = Math.round(used * 100) / 100;
  base.remaining_credits = Math.max(0, Math.round(remaining * 100) / 100);

  if (remaining < costThisOp || (quantity === 0 && remaining <= 0)) {
    return {
      ...base,
      allowed: false,
      reason: `Quota organisation atteint (${base.used_credits}/${totalQuota} crédits ce mois-ci).`,
    };
  }
  return base;
}

/**
 * Enregistre la consommation via log_org_usage (incrément ATOMIQUE :
 * un upsert naïf écraserait le compteur du mois au lieu de l'incrémenter).
 */
export async function logQuotaUsage(
  orgId: string,
  operationType: string,
  quantity = 1,
  description?: string,
): Promise<boolean> {
  const { error } = await supabase.rpc("log_org_usage", {
    p_org_id: orgId,
    p_operation_type: operationType,
    p_quantity: quantity,
    p_description: description ?? null,
  });
  if (error) {
    console.error("[quota-utils] log_org_usage failed:", error.message);
    return false;
  }
  return true;
}
