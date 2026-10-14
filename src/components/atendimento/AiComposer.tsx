import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, ImagePlus, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHAT_LIMITS,
  IMAGE_TYPES,
  DOCUMENT_TYPES,
  attachmentError,
} from "@/lib/atendimento/copilot-chat";

export interface Attachment {
  id: string;
  file: File;
  previewUrl: string | null;
}
const release = (items: Attachment[]) =>
  items.forEach((a) => {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
  });

export function AiComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = "Pergunte à Lume…",
  allowAttachments = true,
  label = "Pergunte para a IA sobre esta conversa",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string, attachments: Attachment[]) => Promise<boolean> | boolean | void;
  disabled?: boolean;
  placeholder?: string;
  allowAttachments?: boolean;
  label?: string;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const current = useRef<Attachment[]>([]);
  const busy = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const locked = disabled || submitting;
  useEffect(() => () => release(current.current), []);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
    };
    resize();
    // A lateral animada muda de largura mesmo quando o texto permanece igual.
    if (typeof ResizeObserver === "undefined") return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);
  function update(items: Attachment[]) {
    current.current = items;
    setAttachments(items);
  }
  function addFiles(files: FileList | File[]) {
    if (locked || !allowAttachments) return;
    let message: string | null = null;
    const next = [...current.current];
    for (const file of Array.from(files)) {
      const invalid = attachmentError(file);
      if (invalid) {
        message = invalid;
        continue;
      }
      if (next.length >= CHAT_LIMITS.files) {
        message = "Envie até 5 anexos.";
        break;
      }
      if (next.reduce((sum, a) => sum + a.file.size, 0) + file.size > CHAT_LIMITS.totalBytes) {
        message = "Os anexos juntos podem ter até 10 MB.";
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
    }
    update(next);
    setError(message);
  }
  async function submit() {
    if (locked || busy.current || (!value.trim() && !current.current.length)) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await onSubmit(value.trim(), current.current);
      if (accepted !== false) {
        release(current.current);
        update([]);
      }
    } catch {
      setError("Não foi possível enviar. Seus anexos foram mantidos.");
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!locked && allowAttachments) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
      className="min-w-0"
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="relative flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border bg-background p-1.5 pr-7"
            >
              {a.previewUrl ? (
                <img
                  src={a.previewUrl}
                  alt={a.file.name}
                  className="h-10 w-10 rounded-lg object-cover"
                />
              ) : (
                <FileText className="m-2 h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <span className="max-w-28 truncate text-xs">{a.file.name}</span>
              <button
                type="button"
                disabled={locked}
                aria-label={`Remover ${a.file.name}`}
                className="absolute right-1 top-1 rounded-full p-1 hover:bg-accent disabled:opacity-40"
                onClick={() => {
                  release([a]);
                  update(current.current.filter((item) => item.id !== a.id));
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={cn(
          "flex items-end gap-1 rounded-[24px] border bg-secondary/40 py-1 pl-4 pr-1.5 shadow-sm transition-colors focus-within:border-foreground/30",
          dragging ? "border-violet-400 bg-violet-500/10" : "border-border",
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={locked}
          maxLength={CHAT_LIMITS.question}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          className="block max-h-36 min-h-8 min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />
        {allowAttachments && (
          <>
            <button
              type="button"
              disabled={locked}
              onClick={() => imageRef.current?.click()}
              aria-label="Anexar imagem"
              title="Imagens PNG, JPG, WEBP ou GIF — até 5 MB"
              className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => documentRef.current?.click()}
              aria-label="Anexar documento"
              title="Documentos PDF, TXT ou CSV — até 5 MB"
              className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={locked || (!value.trim() && !attachments.length)}
          aria-label="Enviar pergunta"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-30"
        >
          {locked ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
      <input
        ref={imageRef}
        type="file"
        aria-label="Selecionar imagens"
        multiple
        accept={IMAGE_TYPES.join(",")}
        className="hidden"
        disabled={locked}
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={documentRef}
        type="file"
        aria-label="Selecionar documentos"
        multiple
        accept={DOCUMENT_TYPES.join(",")}
        className="hidden"
        disabled={locked}
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
