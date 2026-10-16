import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { loadEnvFile } from "../server/env.js";
import { BUDGET_LOCAL_TABLES, captureBudgetState, persistCloudBudget, readCloudBudget, stateHash, type CloudState } from "../server/budget-cloud.js";

loadEnvFile();
try {
  const remote = await readCloudBudget();
  if (!remote) {
    const previousRuns = readdirSync(resolve("data/migrations"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join("data/migrations", d.name, "migration-result.json")))
      .map((d) => join("data/migrations", d.name)).sort().reverse();
    if (!previousRuns[0]) throw new Error("Conclua a migração inicial antes de ativar a persistência.");
    const seed = JSON.parse(readFileSync(join(previousRuns[0], "snapshot.json"), "utf8"));
    // Gerar uma cópia atual, sem importar o módulo db nem tocar o banco em uso.
    const prepared = spawnSync(process.execPath, ["--import", "tsx", "scripts/supabase-prepare.ts"], { stdio: "inherit", windowsHide: true });
    if (prepared.status !== 0) throw new Error("Não foi possível preparar os cálculos para ativação.");
    const { directory } = JSON.parse(readFileSync("data/migrations/latest.json", "utf8"));
    const snapshot = JSON.parse(readFileSync(join(directory, "snapshot.json"), "utf8"));
    if (snapshot.formulaErrors.length) throw new Error("Há erros de fórmula; a ativação foi interrompida.");
    const original = new Database("data/planejamento.db", { readonly: true });
    const backup = new Database(join(directory, "original.db"), { readonly: true });
    try {
      if (stateHash(captureBudgetState(original)) !== stateHash(captureBudgetState(backup))) throw new Error("O orçamento mudou durante a preparação. Execute novamente sem editar o sistema.");
    } finally { original.close(); backup.close(); }
    const tables = Object.fromEntries(BUDGET_LOCAL_TABLES.filter((t) => snapshot.tables[t]).map((t) => [t, snapshot.tables[t]]));
    const state: CloudState = { format: 1, namespace: seed.sourceSha256, initialSafra: seed.currentSafraId, tables };
    const revision = await persistCloudBudget(state, 0, snapshot);
    const stored = await readCloudBudget();
    if (!stored || Number(stored.revisao) !== revision || stateHash(stored.estado.tables) !== stateHash(state.tables)) throw new Error("A conferência da persistência não passou. O modo local foi mantido.");
    writeFileSync(join(directory, "activation-result.json"), JSON.stringify({ revision, tables: Object.keys(tables), verified: true }, null, 2));
    console.log(`Estado exato de ${Object.keys(tables).length} tabelas preservado e conferido no Supabase.`);
  } else {
    console.log(`Persistência existente: revisão ${remote.revisao}. Nenhum estado remoto foi sobrescrito.`);
  }
  const envPath = resolve(".env");
  let env = readFileSync(envPath, "utf8");
  if (/^BUDGET_STORAGE\s*=/m.test(env)) env = env.replace(/^BUDGET_STORAGE\s*=.*$/m, "BUDGET_STORAGE=supabase");
  else env += "\n# Orçamento persistente no Supabase; SQLite usado como base de cálculo\nBUDGET_STORAGE=supabase\n";
  writeFileSync(envPath, env);
  console.log("BUDGET_STORAGE=supabase configurado. Reinicie a API para carregar o modo Supabase.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha na ativação do Supabase.");
  console.error("Não foi habilitada nenhuma troca automática de armazenamento.");
  process.exitCode = 1;
}
