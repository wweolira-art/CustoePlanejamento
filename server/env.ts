import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Preserva o formato histórico do projeto: # dentro do valor é literal. */
export function parseProjectEnv(content: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("--")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (values[key] === undefined) values[key] = value;
  }
  return values;
}

let loaded = false;
export function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const [key, value] of Object.entries(parseProjectEnv(readFileSync(path, "utf8")))) {
    if (process.env[key] == null) process.env[key] = value;
  }
}
