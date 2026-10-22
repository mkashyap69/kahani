type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

function emit(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
  if (order[level] < min) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const rest = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line + rest);
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: Record<string, unknown>) => emit("debug", scope, m, e),
    info: (m: string, e?: Record<string, unknown>) => emit("info", scope, m, e),
    warn: (m: string, e?: Record<string, unknown>) => emit("warn", scope, m, e),
    error: (m: string, e?: Record<string, unknown>) => emit("error", scope, m, e),
  };
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
