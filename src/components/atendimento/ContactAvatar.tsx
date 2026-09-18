import { cn } from "@/lib/utils";

export function ContactAvatar({ name, hue, size = 40, online = false }: { name: string; hue: number; size?: number; online?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span className="relative inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, background: `oklch(0.58 0.15 ${hue})`, fontSize: Math.max(11, size * 0.32) }} aria-label={name}>
    {initials || "?"}
    {online && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" aria-label="online" />}
  </span>;
}
