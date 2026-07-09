import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

/**
 * JURIA — invite-user (modèle provisioning)
 *
 * L'admin d'organisation crée DIRECTEMENT le compte du membre : email +
 * mot de passe, compte confirmé immédiatement, prêt à se connecter.
 * Il n'y a plus d'inscription libre sur auth.html : ce provisioning (et
 * celui du superadmin) est le SEUL moyen de créer un compte Juria.
 *
 * Autorité (vérifiée côté serveur, non contournable) :
 *   - le caller est authentifié (JWT), ET
 *   - owner/admin ACTIF de l'organisation cible, OU superadmin plateforme.
 *
 * Garde-fous : limite de sièges (organizations.max_users), rollback du
 * compte auth si l'ajout du membre échoue (pas de compte orphelin).
 *
 * action: "remove" ({ orgId, memberId }) : retire un membre de l'org et
 * supprime son compte auth s'il n'appartient à aucune autre organisation.
 * Interdits : se supprimer soi-même ; supprimer un owner (sauf superadmin).
 */

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  try {
    const { action, email, password, firstName, lastName, role, orgId, memberId } = await req.json()
    const isRemove = action === "remove"

    if (!orgId) {
      return json(400, { error: "orgId requis" })
    }

    const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : ""
    if (!isRemove) {
      if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
        return json(400, { error: "Email invalide" })
      }
      if (!password || typeof password !== "string" || password.length < 8) {
        return json(400, { error: "Mot de passe requis (8 caractères minimum)" })
      }
    } else if (!memberId) {
      return json(400, { error: "memberId requis" })
    }
    const memberRole = ["member", "admin", "viewer", "lawyer"].includes(role) ? role : "member"

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !serviceKey) {
      throw new Error("Missing Supabase configuration")
    }

    // ── Authentification du caller ───────────────────────────────────────
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json(401, { error: "Non autorisé" })

    const supabaseUser = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user: caller }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !caller) return json(401, { error: "Session invalide" })

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ── Autorité : owner/admin actif de l'org, ou superadmin ────────────
    const [membershipRes, superadminRes] = await Promise.all([
      admin.from("organization_users")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", caller.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
      admin.from("superadmins")
        .select("user_id")
        .eq("user_id", caller.id)
        .maybeSingle(),
    ])

    const isOrgAdmin = ["owner", "admin"].includes(membershipRes.data?.role || "")
    const isSuperadmin = !!superadminRes.data
    if (!isOrgAdmin && !isSuperadmin) {
      return json(403, { error: "Seul un administrateur de l'organisation peut gérer les membres" })
    }

    // ── ACTION REMOVE : retirer un membre ────────────────────────────────
    if (isRemove) {
      const { data: target, error: targetError } = await admin
        .from("organization_users")
        .select("id, user_id, email, role")
        .eq("id", memberId)
        .eq("organization_id", orgId)
        .maybeSingle()
      if (targetError) throw new Error(JSON.stringify(targetError))
      if (!target) return json(404, { error: "Membre introuvable dans cette organisation" })

      if (target.user_id && target.user_id === caller.id) {
        return json(400, { error: "Vous ne pouvez pas supprimer votre propre compte" })
      }
      if (target.role === "owner" && !isSuperadmin) {
        return json(403, { error: "Le propriétaire de l'organisation ne peut être supprimé que par Juria" })
      }

      const { error: delMemberError } = await admin
        .from("organization_users")
        .delete()
        .eq("id", target.id)
      if (delMemberError) return json(500, { error: `Suppression impossible : ${delMemberError.message}` })

      // Compte auth : supprimé seulement s'il n'appartient à aucune autre org
      let authDeleted = false
      if (target.user_id) {
        const { count } = await admin
          .from("organization_users")
          .select("id", { count: "exact", head: true })
          .eq("user_id", target.user_id)
        if ((count ?? 0) === 0) {
          const { error: delAuthError } = await admin.auth.admin.deleteUser(target.user_id)
          authDeleted = !delAuthError
          if (delAuthError) console.error("[invite-user] deleteUser failed:", delAuthError.message)
        }
      }

      return json(200, {
        success: true,
        message: authDeleted
          ? "Membre retiré et compte supprimé."
          : "Membre retiré de l'organisation.",
      })
    }

    // ── Limite de sièges ─────────────────────────────────────────────────
    const { data: org } = await admin
      .from("organizations")
      .select("max_users")
      .eq("id", orgId)
      .single()
    if (!org) return json(404, { error: "Organisation introuvable" })

    if (org.max_users) {
      const { count } = await admin
        .from("organization_users")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("is_active", true)
      if ((count ?? 0) >= org.max_users) {
        return json(409, {
          error: `Limite de ${org.max_users} utilisateurs atteinte pour cette organisation. Contactez Juria pour augmenter le nombre de sièges.`,
        })
      }
    }

    // ── Création du compte auth (confirmé, prêt à se connecter) ─────────
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    })

    if (createError || !created?.user) {
      const msg = createError?.message || "Création du compte impossible"
      const already = /already|exists|registered/i.test(msg)
      return json(already ? 409 : 500, {
        error: already
          ? "Un compte existe déjà avec cet email."
          : `Création du compte impossible : ${msg}`,
      })
    }

    // ── Rattachement à l'organisation (rollback du compte si échec) ─────
    const { data: member, error: addError } = await admin
      .from("organization_users")
      .insert({
        organization_id: orgId,
        user_id: created.user.id,
        email: normalizedEmail,
        first_name: firstName || null,
        last_name: lastName || null,
        role: memberRole,
        invited_by: caller.id,
        invited_at: new Date().toISOString(),
        is_active: true,
      })
      .select()
      .single()

    if (addError) {
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return json(500, { error: `Rattachement à l'organisation impossible : ${addError.message}` })
    }

    return json(200, {
      success: true,
      message: "Compte créé. Transmettez les identifiants à l'utilisateur.",
      member,
      loginLink: "/auth.html?email=" + encodeURIComponent(normalizedEmail),
    })
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error"
    console.error("[invite-user] Error:", errorMsg)
    return json(500, { error: errorMsg })
  }
})
