// Skeleton estável exibido durante loading/preparing da conversa.
// Estrutura fixa (alturas conhecidas) — não causa layout shift ao ser
// substituído pelo Virtuoso revelado.

import { memo } from "react";

const ROWS: Array<{ side: "left" | "right"; width: string; height: string }> = [
  { side: "left", width: "70%", height: "48px" },
  { side: "right", width: "55%", height: "36px" },
  { side: "left", width: "80%", height: "60px" },
  { side: "right", width: "45%", height: "36px" },
  { side: "left", width: "60%", height: "44px" },
  { side: "right", width: "50%", height: "40px" },
];

function ChatSkeletonImpl() {
  return (
    <div
      className="h-full w-full flex flex-col justify-end gap-3 px-3 md:px-4 pb-4 overflow-hidden"
      aria-hidden="true"
      data-testid="chat-skeleton"
    >
      {ROWS.map((row, i) => (
        <div
          key={i}
          className={
            row.side === "left"
              ? "flex justify-start"
              : "flex justify-end"
          }
        >
          <div
            className="rounded-2xl bg-muted/60 animate-pulse"
            style={{ width: row.width, height: row.height }}
          />
        </div>
      ))}
    </div>
  );
}

export const ChatSkeleton = memo(ChatSkeletonImpl);
