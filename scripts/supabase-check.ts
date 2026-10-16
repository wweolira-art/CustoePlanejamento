import { loadEnvFile } from "../server/env.js";
import { checkSupabaseTables, supabaseConfig } from "../server/supabase.js";

try {
  loadEnvFile();
  supabaseConfig();
  const results = await checkSupabaseTables();
  for (const row of results) {
    console.log(`${row.ok ? "OK" : "FALHA"} ${row.table}${row.error ? `: ${row.error}` : ""}`);
  }
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao verificar o Supabase.");
  process.exitCode = 1;
}
