import { UserCheck } from "lucide-react";
import type { TeamUser } from "@/lib/users.functions";

/** Quem entrou por link com aprovação e ainda espera o administrador. */
export function PendingApprovals({
  members,
  busy,
  onApprove,
  onReject,
}: {
  members: TeamUser[];
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const pending = members.filter((member) => member.approvalPending && !member.active);
  if (!pending.length) return null;
  return (
    <section
      aria-label="Aguardando aprovação"
      className="mb-6 rounded-2xl border border-violet-500/40 bg-violet-500/5 p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <UserCheck className="h-4 w-4 text-violet-400" />
        Aguardando aprovação
      </h3>
      <ul className="mt-3 space-y-2">
        {pending.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <b className="block truncate">{member.displayName || member.email}</b>
              <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className="rounded-full border border-border px-3.5 py-1.5 text-sm transition-colors hover:bg-secondary"
                onClick={() => onReject(member.id)}
              >
                Recusar
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-full bg-gradient-to-br from-[#6d45d6] to-[#9b7bf0] px-3.5 py-1.5 text-sm font-semibold text-white"
                onClick={() => onApprove(member.id)}
              >
                Aprovar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
