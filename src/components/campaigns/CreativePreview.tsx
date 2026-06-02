import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Check } from "lucide-react";

export interface CreativePreviewData {
  headline: string;
  primary_text: string;
  cta: string;
  media_url: string;
  media_type: string;
  product?: string;
}

type Mode = "feed" | "story" | "whatsapp";

export function CreativePreview({ data }: { data: CreativePreviewData }) {
  const [mode, setMode] = useState<Mode>("feed");
  const [updating, setUpdating] = useState(false);
  const firstRender = useRef(true);

  // Pulso curto ao mudar conteúdo — sensação "viva".
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setUpdating(true);
    const t = setTimeout(() => setUpdating(false), 220);
    return () => clearTimeout(t);
  }, [data.headline, data.primary_text, data.cta, data.media_url, data.media_type, mode]);

  return (
    <div className="space-y-2.5">
      <div className="inline-flex rounded-md border bg-background p-0.5 text-xs">
        {(["feed", "story", "whatsapp"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-2.5 h-7 rounded capitalize transition-all ${
              mode === m ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent"
            }`}
          >
            {m === "whatsapp" ? "WhatsApp" : m}
          </button>
        ))}
      </div>

      <div className="relative flex justify-center bg-muted/30 rounded-xl p-3 overflow-hidden">
        <div
          key={mode}
          className={`transition-all duration-200 ${updating ? "opacity-70 scale-[0.995] blur-[0.3px]" : "opacity-100 scale-100 blur-0"} animate-fade-in`}
        >
          {mode === "feed" && <FeedPreview data={data} />}
          {mode === "story" && <StoryPreview data={data} />}
          {mode === "whatsapp" && <WhatsAppPreview data={data} />}
        </div>
        {updating && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 bg-primary/60 animate-[preview-shimmer_0.6s_ease-in-out]" />
          </div>
        )}
      </div>

      <style>{`
        @keyframes preview-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

function Media({ url, type, className }: { url: string; type: string; className: string }) {
  if (!url) {
    return (
      <div className={`${className} flex items-center justify-center bg-muted text-muted-foreground`}>
        <ImageIcon className="h-8 w-8" />
      </div>
    );
  }
  if (type === "video") {
    return <video src={url} className={`${className} object-cover`} muted playsInline />;
  }
  return <img src={url} alt="" className={`${className} object-cover`} />;
}

function FeedPreview({ data }: { data: CreativePreviewData }) {
  return (
    <div className="w-[320px] bg-background rounded-lg border shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-pink-500 via-orange-400 to-yellow-300" />
        <div className="flex-1 text-xs">
          <div className="font-semibold">sua_empresa</div>
          <div className="text-[10px] text-muted-foreground">Patrocinado</div>
        </div>
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </div>
      <Media url={data.media_url} type={data.media_type} className="w-full aspect-square" />
      <div className="px-3 pt-2 flex items-center gap-3 text-foreground">
        <Heart className="h-5 w-5" />
        <MessageCircle className="h-5 w-5" />
        <Send className="h-5 w-5" />
        <Bookmark className="h-5 w-5 ml-auto" />
      </div>
      <div className="px-3 py-2 text-xs space-y-1">
        {data.headline && <div className="font-semibold leading-snug line-clamp-2 tracking-tight">{data.headline}</div>}
        {data.primary_text && (
          <div className="text-muted-foreground line-clamp-3">{data.primary_text}</div>
        )}
      </div>
      {data.cta && (
        <button className="w-full text-xs font-medium py-2.5 border-t bg-accent/30 hover:bg-accent">
          {data.cta} ›
        </button>
      )}
    </div>
  );
}

function StoryPreview({ data }: { data: CreativePreviewData }) {
  return (
    <div className="w-[220px] aspect-[9/16] rounded-2xl overflow-hidden relative bg-black shadow-lg">
      <Media url={data.media_url} type={data.media_type} className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-x-0 top-0 p-2 flex gap-1">
        <div className="h-0.5 bg-white/80 rounded flex-1" />
      </div>
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 pt-1">
        <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-pink-500 via-orange-400 to-yellow-300 ring-2 ring-white" />
        <span className="text-[10px] text-white font-semibold drop-shadow">sua_empresa</span>
        <span className="text-[9px] text-white/70 ml-auto">Patrocinado</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent text-white space-y-2">
        {data.headline && <div className="text-sm font-semibold drop-shadow line-clamp-2 leading-snug tracking-tight">{data.headline}</div>}
        {data.cta && (
          <button className="w-full bg-white text-black text-xs font-semibold py-2 rounded-full">
            {data.cta}
          </button>
        )}
      </div>
    </div>
  );
}

function WhatsAppPreview({ data }: { data: CreativePreviewData }) {
  const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="w-[300px] rounded-lg overflow-hidden border shadow-sm bg-[#e5ddd5] dark:bg-[#0b141a]">
      <div className="bg-[#075e54] text-white px-3 py-2 flex items-center gap-2 text-xs">
        <div className="h-7 w-7 rounded-full bg-white/20" />
        <div className="flex-1">
          <div className="font-semibold">Sua Empresa</div>
          <div className="text-[10px] opacity-80">online</div>
        </div>
      </div>
      <div
        className="p-3 space-y-2 min-h-[260px]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(0,0,0,0.04) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div className="max-w-[85%] bg-white dark:bg-[#202c33] rounded-lg shadow-sm overflow-hidden">
          {data.media_url && (
            <Media
              url={data.media_url}
              type={data.media_type}
              className="w-full h-32 rounded-t-lg"
            />
          )}
          <div className="p-2 text-xs space-y-1">
            {data.headline && <div className="font-semibold">{data.headline}</div>}
            {data.primary_text && (
              <div className="whitespace-pre-wrap line-clamp-4">{data.primary_text}</div>
            )}
            <div className="text-[10px] text-muted-foreground text-right flex items-center justify-end gap-0.5 pt-1">
              {now}
              <Check className="h-3 w-3 text-sky-500" />
              <Check className="h-3 w-3 -ml-2 text-sky-500" />
            </div>
          </div>
          {data.cta && (
            <button className="w-full text-xs font-medium text-sky-600 py-2 border-t hover:bg-accent/30">
              {data.cta}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
