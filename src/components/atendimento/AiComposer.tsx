import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Campo de pergunta para a IA.
 *
 * Superfície neutra de propósito: borda fina, fundo igual ao da página, sem
 * gradiente. O gradiente anterior competia com a orbe pelo mesmo olhar — num
 * painel que só tem dois elementos, o segundo aceso vira ruído.
 *
 * Três formas de anexar, porque atendente manda print de três jeitos:
 * botão, colar (Ctrl+V) e arrastar. A de colar é a mais usada e a que
 * costuma faltar.
 */

export interface Attachment {
  id: string;
  file: File;
  /** objectURL para imagem; null para os demais tipos. */
  previewUrl: string | null;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv";

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AiComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "Perguntar",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // objectURL é um recurso do documento, não do React: sem revoke o navegador
  // segura o blob até a aba fechar.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na desmontagem
  }, []);

  // Altura acompanha o conteúdo, com teto. Reseta para "auto" antes de medir,
  // senão o scrollHeight nunca diminui ao apagar texto.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const addFiles = useCallback((files: FileList | File[]) => {
    setError(null);
    const incoming = Array.from(files);
    const accepted: Attachment[] = [];

    for (const file of incoming) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`"${file.name}" passa de ${formatSize(MAX_FILE_BYTES)}`);
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        previewUrl: isImage(file) ? URL.createObjectURL(file) : null,
      });
    }

    setAttachments((prev) => {
      const room = MAX_ATTACHMENTS - prev.length;
      if (accepted.length > room) {
        setError(`Máximo de ${MAX_ATTACHMENTS} anexos`);
      }
      // Os excedentes já criaram objectURL; revoga agora para não vazar.
      for (const extra of accepted.slice(Math.max(room, 0))) {
        if (extra.previewUrl) URL.revokeObjectURL(extra.previewUrl);
      }
      return [...prev, ...accepted.slice(0, Math.max(room, 0))];
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const submit = useCallback(() => {
    const text = value.trim();
    if (disabled || (!text && attachments.length === 0)) return;
    onSubmit(text, attachments);
    setAttachments([]);
    setError(null);
  }, [attachments, disabled, onSubmit, value]);

  /** Print colado chega como item de imagem no clipboard, sem nome de arquivo. */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    },
    [addFiles],
  );

  const canSend = !disabled && (value.trim().length > 0 || attachments.length > 0);

  return (
    <div className="shrink-0">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          // Fundo igual ao da página e borda fina: o campo se apresenta pela
          // forma, não pela cor.
          "rounded-2xl border bg-background transition-colors",
          dragging ? "border-foreground/40 bg-accent/30" : "border-border",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group relative flex items-center gap-2 rounded-lg border border-border bg-secondary py-1.5 pl-1.5 pr-7"
              >
                {a.previewUrl ? (
                  <img
                    src={a.previewUrl}
                    alt={a.file.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-accent">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </span>
                )}
                <span className="max-w-[110px] truncate text-[11px] font-medium">
                  {a.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`Remover ${a.file.name}`}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            // Enter envia, Shift+Enter quebra linha — convenção de chat.
            // `isComposing` protege teclado de IME (acento, emoji): durante a
            // composição o Enter confirma o caractere, não envia.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={placeholder}
          aria-label="Pergunte para a IA sobre esta conversa"
          className="block max-h-40 w-full resize-none bg-transparent px-4 pb-2 pt-3 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Anexar arquivo ou imagem"
            title="Anexar arquivo, imagem ou print (também aceita colar e arrastar)"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Enviar pergunta"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
              canSend
                ? "bg-foreground text-background hover:opacity-90"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            // Zera para o mesmo arquivo poder ser escolhido duas vezes.
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-1.5 px-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
