import { useState } from "react";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import { useLeadAssignment, useTeamDirectory } from "@/hooks/useLeadAssignment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function OwnerBadge({ userId }: { userId?: string | null }) {
  const directory = useTeamDirectory();
  const member = directory.data?.find((item) => item.id === userId);
  if (!directory.data) return null;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
      title={userId ? (member?.name ?? "Atendente responsável") : "Disponível para assumir"}
    >
      <UserRound className="h-3 w-3 shrink-0" />
      <span className="truncate">{userId ? (member?.name ?? "Atendente") : "Disponível"}</span>
    </span>
  );
}
function useOwnerChange(leadId: string) {
  const assignment = useLeadAssignment(leadId);
  const [busy, setBusy] = useState(false);
  const change = async (value: string | null) => {
    setBusy(true);
    try {
      await assignment.assign(value);
      toast.success(value ? "Responsável atualizado" : "Atendimento liberado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível transferir");
    } finally {
      setBusy(false);
    }
  };
  return { assignment, busy, change };
}

/**
 * Versão enxuta para o topo da conversa no Chat: quem já pode responder vê
 * só um chip com o responsável, e liberar/transferir moram no menu dele.
 * A faixa larga ({@link ConversationOwner}) aparece apenas quando falta
 * alguma ação para conseguir responder.
 */
export function ConversationOwnerChip({ leadId }: { leadId: string }) {
  const { assignment, busy, change } = useOwnerChange(leadId);
  const directory = useTeamDirectory();
  if (!assignment.ready || !assignment.canReply || assignment.isError || assignment.isPending) {
    return null;
  }
  const member = directory.data?.find((item) => item.id === assignment.assignedTo);
  const name = assignment.assignedTo ? (member?.name ?? "Atendente") : "Disponível";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          title="Responsável pelo atendimento"
          className="inline-flex max-w-[9rem] items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          <UserRound className="h-3 w-3 shrink-0" />
          <span className="truncate">{name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Responsável</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void change(null)}>Liberar atendimento</DropdownMenuItem>
        {assignment.canTransfer && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Transferir para
            </DropdownMenuLabel>
            {directory.data
              ?.filter((p) => p.canReply && p.id !== assignment.assignedTo)
              .map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => void change(p.id)}>
                  {p.name}
                </DropdownMenuItem>
              ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConversationOwner({
  leadId,
  onlyWhenBlocked = false,
}: {
  leadId: string;
  /** Some quando o usuário já pode responder (o chip do topo cobre esse caso). */
  onlyWhenBlocked?: boolean;
}) {
  const { assignment, busy, change } = useOwnerChange(leadId);
  const directory = useTeamDirectory();
  if (!assignment.ready) return null;
  if (onlyWhenBlocked && assignment.canReply && !assignment.isError) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
      <OwnerBadge userId={assignment.assignedTo} />
      {assignment.isError ? (
        <span role="alert" className="text-destructive">
          Não foi possível verificar o responsável.
        </span>
      ) : assignment.isPending ? (
        <span className="text-muted-foreground">Verificando atendimento…</span>
      ) : (
        <>
          {assignment.canClaim && (
            <button
              disabled={busy}
              className="rounded-full bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
              onClick={() => void change(assignment.userId!)}
            >
              Assumir atendimento
            </button>
          )}
          {assignment.canReply && (
            <button
              disabled={busy}
              className="rounded-full border border-border px-3 py-1"
              onClick={() => void change(null)}
            >
              Liberar
            </button>
          )}
          {assignment.canTransfer && (
            <select
              aria-label="Transferir atendimento"
              disabled={busy}
              value={assignment.assignedTo ?? ""}
              className="max-w-48 rounded-full border border-border bg-background px-2 py-1"
              onChange={(e) => void change(e.target.value || null)}
            >
              <option value="">Sem responsável</option>
              {directory.data
                ?.filter((p) => p.canReply)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          )}
          {!assignment.canReply && (
            <span className="text-muted-foreground">
              {assignment.assignedTo
                ? "Somente o responsável pode responder. Solicite a transferência."
                : "Assuma o atendimento para responder."}
            </span>
          )}
        </>
      )}
    </div>
  );
}
