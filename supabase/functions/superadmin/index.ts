import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

/**
 * JURIA — superadmin
 * Back-office fondateur : gestion des organisations clientes.
 *
 * Toutes les actions exigent que l'utilisateur authentifié figure dans la
 * table `superadmins` (vérification service role, non contournable).
 *
 * Actions (POST { action, ...payload }) :
 *   - list_orgs    : organisations + membres + consommation du mois
 *   - create_org   : créer une org cliente + inviter son premier admin
 *   - update_org   : modifier name / plan / monthly_quota / max_users
 *   - org_usage    : historique de consommation d'une org (12 mois)
 *   - update_cost  : ajuster le coût unitaire d'une opération
 */

const PLANS = ["trial", "essential", "pro", "cabinet", "enterprise", "bank"];

function json(status: number, body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function slugify(name: string): string {
  const base = name.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("Origin"));
  const preflight = handleCorsPreFlight(req);
  if (preflight) return preflight;

  try {
    // ── Authentification ────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Non autorisé" }, corsHeaders);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) return json(401, { error: "Session invalide" }, corsHeaders);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // ── Autorité : superadmin uniquement ────────────────────────────────
    const { data: sa } = await admin
      .from("superadmins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!sa) return json(403, { error: "Accès réservé au superadmin" }, corsHeaders);

    const body = await req.json();
    const { action } = body;
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
      .toISOString().split("T")[0];

    // ── LIST_ORGS ────────────────────────────────────────────────────────
    if (action === "list_orgs") {
      const [orgsRes, membersRes, usageRes, costsRes] = await Promise.all([
        admin.from("organizations")
          .select("id, name, slug, plan, max_users, monthly_quota, created_at")
          .order("created_at", { ascending: false }),
        admin.from("organization_users")
          .select("organization_id, user_id, is_active"),
        admin.from("organization_usage")
          .select("org_id, operation_type, count, total_cost")
          .eq("month", monthStart),
        admin.from("operation_costs")
          .select("operation_type, base_cost, description"),
      ]);
      if (orgsRes.error) return json(500, { error: orgsRes.error.message }, corsHeaders);

      const members: Record<string, { total: number; active: number; pending: number }> = {};
      for (const m of membersRes.data || []) {
        const s = members[m.organization_id] ??= { total: 0, active: 0, pending: 0 };
        s.total++;
        if (m.user_id && m.is_active) s.active++;
        if (!m.user_id) s.pending++;   // invitation non réclamée
      }

      const usage: Record<string, { used: number; breakdown: Record<string, { count: number; cost: number }> }> = {};
      for (const u of usageRes.data || []) {
        const s = usage[u.org_id] ??= { used: 0, breakdown: {} };
        s.used += u.total_cost;
        s.breakdown[u.operation_type] = {
          count: (s.breakdown[u.operation_type]?.count || 0) + u.count,
          cost: (s.breakdown[u.operation_type]?.cost || 0) + u.total_cost,
        };
      }

      const orgs = (orgsRes.data || []).map((o) => ({
        ...o,
        members: members[o.id] || { total: 0, active: 0, pending: 0 },
        used_credits: Math.round((usage[o.id]?.used || 0) * 100) / 100,
        breakdown: usage[o.id]?.breakdown || {},
      }));

      return json(200, { orgs, month: monthStart, costs: costsRes.data || [] }, corsHeaders);
    }

    // ── CREATE_ORG ───────────────────────────────────────────────────────
    // Modèle provisioning : le superadmin définit email + mot de passe du
    // premier admin ; le compte est créé confirmé, prêt à se connecter.
    if (action === "create_org") {
      const { name, plan, monthly_quota, max_users, admin_email, admin_password, admin_first_name, admin_last_name } = body;
      if (!name || !String(name).trim()) return json(400, { error: "Nom d'organisation requis" }, corsHeaders);
      if (plan && !PLANS.includes(plan)) return json(400, { error: `Plan invalide (${PLANS.join(", ")})` }, corsHeaders);
      const quota = Number.isFinite(Number(monthly_quota)) ? Number(monthly_quota) : 1000;
      if (quota < -1) return json(400, { error: "Quota invalide (-1 = illimité)" }, corsHeaders);
      const email = String(admin_email || "").toLowerCase().trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json(400, { error: "Email du premier admin requis et valide" }, corsHeaders);
      }
      if (!admin_password || typeof admin_password !== "string" || admin_password.length < 8) {
        return json(400, { error: "Mot de passe du premier admin requis (8 caractères minimum)" }, corsHeaders);
      }

      // Compte auth d'abord : si l'email existe déjà, on n'a rien créé.
      const fullName = [admin_first_name, admin_last_name].filter(Boolean).join(" ").trim();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: admin_password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      });
      if (createError || !created?.user) {
        const msg = createError?.message || "Création du compte impossible";
        const already = /already|exists|registered/i.test(msg);
        return json(already ? 409 : 500, {
          error: already ? "Un compte existe déjà avec cet email." : `Création du compte impossible : ${msg}`,
        }, corsHeaders);
      }

      const { data: org, error: orgError } = await admin
        .from("organizations")
        .insert({
          name: String(name).trim(),
          slug: slugify(String(name)),
          plan: plan || "trial",
          max_users: Number(max_users) > 0 ? Number(max_users) : 5,
          country: "MA",
          monthly_quota: quota,
        })
        .select("id, name, slug, plan, max_users, monthly_quota")
        .single();
      if (orgError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return json(500, { error: orgError.message }, corsHeaders);
      }

      const { error: memberError } = await admin
        .from("organization_users")
        .insert({
          organization_id: org.id,
          user_id: created.user.id,
          email,
          first_name: admin_first_name || null,
          last_name: admin_last_name || null,
          role: "owner",
          invited_by: user.id,
          invited_at: new Date().toISOString(),
          is_active: true,
        });
      if (memberError) {
        // Rollback complet : ni compte orphelin, ni org vide.
        await admin.from("organizations").delete().eq("id", org.id).catch(() => {});
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return json(500, { error: `Rattachement du premier admin impossible : ${memberError.message}` }, corsHeaders);
      }

      return json(200, {
        success: true,
        org,
        admin_email: email,
        login_link: "auth.html?email=" + encodeURIComponent(email),
      }, corsHeaders);
    }

    // ── UPDATE_ORG ───────────────────────────────────────────────────────
    if (action === "update_org") {
      const { org_id, updates } = body;
      if (!org_id || !updates || typeof updates !== "object") {
        return json(400, { error: "org_id et updates requis" }, corsHeaders);
      }
      const allowed: Record<string, unknown> = {};
      if (updates.name !== undefined) {
        if (!String(updates.name).trim()) return json(400, { error: "Nom invalide" }, corsHeaders);
        allowed.name = String(updates.name).trim();
      }
      if (updates.plan !== undefined) {
        if (!PLANS.includes(updates.plan)) return json(400, { error: "Plan invalide" }, corsHeaders);
        allowed.plan = updates.plan;
      }
      if (updates.monthly_quota !== undefined) {
        const q = Number(updates.monthly_quota);
        if (!Number.isFinite(q) || q < -1) return json(400, { error: "Quota invalide" }, corsHeaders);
        allowed.monthly_quota = q;
      }
      if (updates.max_users !== undefined) {
        const m = Number(updates.max_users);
        if (!Number.isFinite(m) || m < 1) return json(400, { error: "max_users invalide" }, corsHeaders);
        allowed.max_users = m;
      }
      if (Object.keys(allowed).length === 0) return json(400, { error: "Aucun champ modifiable fourni" }, corsHeaders);

      const { data: org, error } = await admin
        .from("organizations")
        .update(allowed)
        .eq("id", org_id)
        .select("id, name, plan, max_users, monthly_quota")
        .single();
      if (error) return json(500, { error: error.message }, corsHeaders);

      return json(200, { success: true, org }, corsHeaders);
    }

    // ── ORG_USAGE (historique 12 mois) ──────────────────────────────────
    if (action === "org_usage") {
      const { org_id } = body;
      if (!org_id) return json(400, { error: "org_id requis" }, corsHeaders);

      const yearAgo = new Date();
      yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11, 1);
      const from = yearAgo.toISOString().split("T")[0];

      const { data, error } = await admin
        .from("organization_usage")
        .select("month, operation_type, count, total_cost")
        .eq("org_id", org_id)
        .gte("month", from)
        .order("month", { ascending: true });
      if (error) return json(500, { error: error.message }, corsHeaders);

      return json(200, { usage: data || [] }, corsHeaders);
    }

    // ── UPDATE_COST ──────────────────────────────────────────────────────
    if (action === "update_cost") {
      const { operation_type, base_cost } = body;
      const cost = Number(base_cost);
      if (!operation_type || !Number.isFinite(cost) || cost < 0) {
        return json(400, { error: "operation_type et base_cost (≥ 0) requis" }, corsHeaders);
      }
      const { data, error } = await admin
        .from("operation_costs")
        .update({ base_cost: cost, updated_at: new Date().toISOString() })
        .eq("operation_type", operation_type)
        .select("operation_type, base_cost")
        .single();
      if (error) return json(500, { error: error.message }, corsHeaders);

      return json(200, { success: true, cost: data }, corsHeaders);
    }

    return json(400, { error: "action invalide (list_orgs | create_org | update_org | org_usage | update_cost)" }, corsHeaders);
  } catch (error) {
    const message = (error as { message?: string })?.message || "Erreur interne";
    console.error("[superadmin]", message);
    return json(500, { error: message }, corsHeaders);
  }
});
