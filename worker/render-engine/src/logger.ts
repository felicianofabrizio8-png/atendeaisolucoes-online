type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let current: Level = "info";
export function setLogLevel(l: Level) { current = l; }

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[current]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitize(fields ?? {}),
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function sanitize(o: Record<string, unknown>): Record<string, unknown> {
  const bad = /(token|secret|password|authorization|signed_?url|apikey|signature|bearer)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (bad.test(k)) out[k] = "[redacted]";
    else if (typeof v === "string" && v.length > 4000) out[k] = v.slice(0, 4000) + "…";
    else out[k] = v;
  }
  return out;
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info:  (event: string, fields?: Record<string, unknown>) => emit("info",  event, fields),
  warn:  (event: string, fields?: Record<string, unknown>) => emit("warn",  event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
