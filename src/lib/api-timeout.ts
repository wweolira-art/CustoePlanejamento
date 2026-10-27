export function apiTimeoutMs(url: string, method = "GET") {
  const path = url.split("?", 1)[0];
  if (path.startsWith("/api/custo/") || path === "/api/custo-colheita" || path === "/api/contract-control/ocorrencias") return 10 * 60_000;
  const gravacao = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (gravacao && /^\/api\/(?:lines|sheets|categories|premissas|calc-rules|distributions|activities|materials|cost-objects|areas|parametros-tecnicos)(?:\/|$)/.test(path)) return 3 * 60_000;
  return 30_000;
}
