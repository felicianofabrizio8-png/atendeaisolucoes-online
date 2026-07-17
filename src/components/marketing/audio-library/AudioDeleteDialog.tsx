import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteAudioById } from "@/lib/audio-library/audio-library-service";
import type { AudioLibraryRow } from "@/lib/audio-library/audio-library.types";

export function AudioDeleteDialog({
  row,
  onClose,
  onDeleted,
}: {
  row: AudioLibraryRow | null;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (!row) return;
    setBusy(true);
    try {
      await deleteAudioById(row.id);
      toast.success("Áudio excluído");
      onClose();
      await onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={!!row} onOpenChange={(v) => (v ? null : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir áudio?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta ação removerá o arquivo do storage e o registro da biblioteca.
            Não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Excluindo…
              </>
            ) : (
              "Excluir"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
