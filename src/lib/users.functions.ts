// Server functions para gestão multiusuário.
// Todas as operações sensíveis são validadas server-side:
//  - confirma que o caller é admin da empresa
//  - protege o último admin (não pode remover/rebaixar)
//  - registra audit_log

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLES = ["admin", "atendente", "financeiro"] as const;
type Role = (typeof ROLES)[number];

interface AdminCtx {
  companyId: string;
  userId: string;
}

async function assertAdmin(ctx: {
  supabase: unknown;
  userId: string;
}): Promise<AdminCtx> {
  const s = ctx.supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, v: string) => {
          maybeSingle: () => Promise<{ data: { company_id: string } | null }>;
        };
      };
    };
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
  };
  const { data: prof } = await s
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (!prof?.company_id) throw new Error("Usuário sem empresa.");
  const { data: isAdmin } = await s.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Apenas administradores podem executar esta ação.");
  return { companyId: prof.company_id, userId: ctx.userId };
}

async function writeAudit(
  companyId: string,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_log").insert({
      company_id: companyId,
      user_id: userId,
      action,
      entity,
      entity_id: entityId,
      before: (before ?? null) as never,
      after: (after ?? null) as never,
    });
  } catch (e) {
    console.error("[audit] failed", e);
  }
}

// ---------- LIST USERS ----------
export const listCompanyUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId } = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, email, created_at, last_seen_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("company_id", companyId);

    const roleByUser = new Map<string, Role>();
    (roles ?? []).forEach((r) => roleByUser.set(r.user_id, r.role as Role));

    return {
      users: (profiles ?? []).map((p) => ({
        id: p.id,
        displayName: p.display_name,
        email: p.email,
        createdAt: p.created_at,
        lastSeenAt: p.last_seen_at,
        role: roleByUser.get(p.id) ?? null,
      })),
    };
  });

// ---------- LIST INVITES ----------
export const listCompanyInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId } = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("company_invites")
      .select("id, email, role, token, expires_at, accepted_at, cancelled_at, created_at, invited_by")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { invites: data ?? [] };
  });

// ---------- CREATE INVITE ----------
const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: z.enum(ROLES),
});

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InviteSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId } = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Avoid duplicate active invite
    const { data: existing } = await supabaseAdmin
      .from("company_invites")
      .select("id")
      .eq("company_id", companyId)
      .eq("email", data.email)
      .is("accepted_at", null)
      .is("cancelled_at", null)
      .maybeSingle();
    if (existing) throw new Error("Já existe um convite pendente para este e-mail.");

    const { data: inserted, error } = await supabaseAdmin
      .from("company_invites")
      .insert({
        company_id: companyId,
        email: data.email,
        role: data.role,
        invited_by: userId,
      })
      .select("id, token, email, role, expires_at")
      .single();
    if (error) throw new Error(error.message);

    await writeAudit(companyId, userId, "invite_user", "company_invite", inserted.id, null, {
      email: data.email,
      role: data.role,
    });

    return { invite: inserted };
  });

// ---------- CANCEL INVITE ----------
export const cancelInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ inviteId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId } = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inv } = await supabaseAdmin
      .from("company_invites")
      .select("id, email, role, company_id, accepted_at, cancelled_at")
      .eq("id", data.inviteId)
      .maybeSingle();
    if (!inv || inv.company_id !== companyId) throw new Error("Convite não encontrado.");
    if (inv.accepted_at) throw new Error("Convite já foi aceito.");
    if (inv.cancelled_at) return { ok: true };

    const { error } = await supabaseAdmin
      .from("company_invites")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", data.inviteId);
    if (error) throw new Error(error.message);

    await writeAudit(companyId, userId, "cancel_invite", "company_invite", inv.id, inv, null);
    return { ok: true };
  });

// ---------- CHANGE ROLE ----------
const ChangeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
});

export const changeUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ChangeRoleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId } = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Confirm target belongs to this company
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target || target.company_id !== companyId) {
      throw new Error("Usuário não pertence a esta empresa.");
    }

    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("id, role")
      .eq("company_id", companyId)
      .eq("user_id", data.userId)
      .maybeSingle();

    const currentRole = existing?.role as Role | undefined;
    if (currentRole === data.role) return { ok: true };

    // Last-admin protection: if demoting an admin, ensure there's another admin
    if (currentRole === "admin" && data.role !== "admin") {
      const { data: adminCount } = await supabaseAdmin.rpc("count_company_admins", {
        _company_id: companyId,
      });
      if ((adminCount ?? 0) <= 1) {
        await writeAudit(
          companyId,
          userId,
          "blocked_last_admin_demote",
          "user_role",
          data.userId,
          { currentRole },
          { attemptedRole: data.role },
        );
        throw new Error("Não é possível rebaixar o último administrador da empresa.");
      }
    }

    if (existing) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .update({ role: data.role })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ company_id: companyId, user_id: data.userId, role: data.role });
      if (error) throw new Error(error.message);
    }

    await writeAudit(
      companyId,
      userId,
      "change_user_role",
      "user_role",
      data.userId,
      { role: currentRole ?? null },
      { role: data.role },
    );
    return { ok: true };
  });

// ---------- REMOVE USER FROM COMPANY ----------
export const removeUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ userId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, userId } = await assertAdmin(context);
    if (data.userId === userId) {
      // Special-case: admin cannot remove self via this UI — keep simple.
      throw new Error("Você não pode remover a si mesmo.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id, company_id, email, display_name")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target || target.company_id !== companyId) {
      throw new Error("Usuário não pertence a esta empresa.");
    }

    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id, role")
      .eq("company_id", companyId)
      .eq("user_id", data.userId)
      .maybeSingle();

    // Last-admin protection
    if (existingRole?.role === "admin") {
      const { data: adminCount } = await supabaseAdmin.rpc("count_company_admins", {
        _company_id: companyId,
      });
      if ((adminCount ?? 0) <= 1) {
        await writeAudit(
          companyId,
          userId,
          "blocked_last_admin_remove",
          "user_role",
          data.userId,
          target,
          null,
        );
        throw new Error("Não é possível remover o último administrador da empresa.");
      }
    }

    // Remove role assignment (does not delete the auth user; just unlinks them)
    if (existingRole) {
      await supabaseAdmin.from("user_roles").delete().eq("id", existingRole.id);
    }

    await writeAudit(
      companyId,
      userId,
      "remove_user",
      "user_role",
      data.userId,
      { ...target, role: existingRole?.role ?? null },
      null,
    );

    return { ok: true };
  });

// ---------- TOUCH LAST SEEN ----------
export const touchLastSeen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = context.supabase as {
      rpc: (fn: string) => Promise<{ error: unknown }>;
    };
    try {
      await s.rpc("touch_last_seen");
    } catch {
      /* noop */
    }
    return { ok: true };
  });
