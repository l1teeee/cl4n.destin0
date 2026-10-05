type LogLevel = "debug" | "info" | "warn" | "error";
type LogField = boolean | number | string | null | undefined;

export function log(level: LogLevel, msg: string, fields: Record<string, LogField> = {}): void {
  const entry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...fields,
  };

  console.log(JSON.stringify(entry));
}
