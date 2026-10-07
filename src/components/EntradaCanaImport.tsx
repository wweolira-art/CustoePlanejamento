import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  api,
  type EntradaCanaImportOptions,
  type EntradaCanaImportResult,
  type EntradaCanaImportType,
  type EntradaCanaOperationMode,
  type EntradaCanaTipoColheitaMode,
} from "../api";
import { useApp } from "../store";

function downloadJsonl(filename: string, lines: string[]) {
  const blob = new Blob([lines.join("\n") + (lines.length ? "\n" : "")], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function readExcelGrid(file: File, sheetNameArg: string): Promise<{ sheetName: string; grid: unknown[][] }> {
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array", cellDates: true });
  const sheetName = sheetNameArg || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba não encontrada: ${sheetName}`);
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
  return { sheetName, grid };
}

export function EntradaCanaImport() {
  const { safras } = useApp();
  const abortRef = useRef<AbortController | null>(null);

  const [importType, setImportType] = useState<EntradaCanaImportType>("maquina");
  const [apiUrl, setApiUrl] = useState("");
  const [tipoColheitaMode, setTipoColheitaMode] = useState<EntradaCanaTipoColheitaMode>("planilha");
  const [operationMode, setOperationMode] = useState<EntradaCanaOperationMode>("insert");
  const [safraSelect, setSafraSelect] = useState("");
  const [safraCustom, setSafraCustom] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [maxRows, setMaxRows] = useState("");
  const [headerRow, setHeaderRow] = useState("");
  const [startRow, setStartRow] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [autoHeader, setAutoHeader] = useState(true);
  const [files, setFiles] = useState<FileList | null>(null);
  const [running, setRunning] = useState(false);
  const [logText, setLogText] = useState("");
  const [result, setResult] = useState<EntradaCanaImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.entradaCanaConfig().then((cfg) => {
      if (importType === "caminhao") setApiUrl(cfg.apiUrls.caminhao);
      else if (importType === "tempo_patio") setApiUrl(cfg.apiUrls.tempo_patio);
      else setApiUrl(cfg.apiUrls.maquina);
    });
    if (importType === "tempo_patio") {
      setSheetName("tempoPatio");
      setHeaderRow("7");
      setStartRow("11");
    }
  }, [importType]);

  const stats = result?.stats;

  const appendLog = (lines: string[]) => {
    setLogText((prev) => (prev ? `${prev}\n${lines.join("\n")}` : lines.join("\n")));
  };

  const runImport = async () => {
    if (running) return;
    const fileList = files ? Array.from(files) : [];
    if (!fileList.length) {
      setErr("Selecione pelo menos um arquivo .xls/.xlsx.");
      return;
    }

    setErr(null);
    setLogText("");
    setResult(null);
    setRunning(true);
    abortRef.current = new AbortController();

    const options: EntradaCanaImportOptions = {
      importType,
      apiUrl: apiUrl.trim() || undefined,
      tipoColheitaMode,
      operationMode,
      safraSelect: safraSelect || undefined,
      safraCustom: safraCustom || undefined,
      sheetName: sheetName.trim() || undefined,
      maxRows: maxRows ? Number(maxRows) : null,
      headerRow: headerRow ? Number(headerRow) : undefined,
      startRow: startRow ? Number(startRow) : undefined,
      dryRun,
      autoHeader,
    };

    try {
      appendLog([`Lendo ${fileList.length} arquivo(s)...`]);
      const parsed = await Promise.all(
        fileList.map(async (file) => {
          const { sheetName: sn, grid } = await readExcelGrid(file, sheetName.trim());
          return { name: file.name, sheetName: sn, grid };
        }),
      );

      appendLog(["Enviando para a API..."]);
      const res = await api.entradaCanaImport({ files: parsed, options });
      setResult(res);
      appendLog(res.logLines);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      appendLog([`Falha: ${msg}`]);
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const cancelImport = () => {
    abortRef.current?.abort();
    appendLog(["Cancelamento solicitado."]);
    setRunning(false);
  };

  return (
    <>
      <p className="lead">
        Importe planilhas XLS/XLSX de entrada de cana (máquina, caminhão ou tempo pátio) para a API ORDS. A leitura da
        planilha é feita no navegador; o envio passa pela API local para evitar CORS.
      </p>

      <section className="panel">
        <h3>Configuração</h3>
        <div className="form-grid">
          <label>
            Tipo de importação
            <select value={importType} onChange={(e) => setImportType(e.target.value as EntradaCanaImportType)}>
              <option value="maquina">Entrada Cana Máquina</option>
              <option value="caminhao">Entrada Cana Caminhão</option>
              <option value="tempo_patio">Tempo pátio</option>
            </select>
          </label>
          <label>
            Planilhas (.xls/.xlsx)
            <input type="file" accept=".xls,.xlsx" multiple onChange={(e) => setFiles(e.target.files)} />
          </label>
          <label className="span-2">
            URL da API
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </label>
          {importType !== "tempo_patio" ? (
            <label>
              Tipo colheita (todos os itens)
              <select
                value={tipoColheitaMode}
                onChange={(e) => setTipoColheitaMode(e.target.value as EntradaCanaTipoColheitaMode)}
              >
                <option value="planilha">Usar coluna da planilha</option>
                <option value="MECANIZADA">Mecanizada</option>
                <option value="MANUAL">Manual</option>
              </select>
            </label>
          ) : null}
          <label>
            Operação
            <select value={operationMode} onChange={(e) => setOperationMode(e.target.value as EntradaCanaOperationMode)}>
              <option value="insert">Inserção (POST)</option>
              <option value="update">Update (PUT)</option>
            </select>
          </label>
          {importType === "caminhao" ? (
            <>
              <label>
                Safra (caminhão)
                <select value={safraSelect} onChange={(e) => setSafraSelect(e.target.value)}>
                  <option value="">Usar coluna da planilha</option>
                  {safras.map((s) => (
                    <option key={s.id} value={s.label}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ou digite outra safra
                <input
                  value={safraCustom}
                  onChange={(e) => setSafraCustom(e.target.value)}
                  placeholder="Ex.: 2025/2026"
                />
              </label>
            </>
          ) : null}
          <label>
            Nome da aba (opcional)
            <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Primeira aba se vazio" />
          </label>
          <label>
            Máximo de linhas (opcional)
            <input value={maxRows} onChange={(e) => setMaxRows(e.target.value)} type="number" min={1} placeholder="Ex.: 500" />
          </label>
          <label>
            Linha do cabeçalho (opcional)
            <input value={headerRow} onChange={(e) => setHeaderRow(e.target.value)} type="number" min={1} placeholder="Ex.: 6" />
          </label>
          <label>
            Linha inicial de dados (opcional)
            <input value={startRow} onChange={(e) => setStartRow(e.target.value)} type="number" min={1} placeholder="Ex.: 9" />
          </label>
        </div>

        <div className="modal-actions" style={{ padding: "0 16px", flexWrap: "wrap", gap: 12 }}>
          <label className="check-label">
            <span className="check-row">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
              Dry run (não envia para API)
            </span>
          </label>
          <label className="check-label">
            <span className="check-row">
              <input type="checkbox" checked={autoHeader} onChange={(e) => setAutoHeader(e.target.checked)} />
              Auto detectar cabeçalho
            </span>
          </label>
        </div>

        {err ? (
          <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>
            {err}
          </p>
        ) : null}

        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button className="btn primary" disabled={running} onClick={() => void runImport()}>
            {running ? "Importando…" : "Executar importação"}
          </button>
          <button className="btn" disabled={!running} onClick={cancelImport}>
            Cancelar
          </button>
          <button
            className="btn"
            disabled={!result?.okLog.length}
            onClick={() =>
              downloadJsonl(`import-ok-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`, result?.okLog ?? [])
            }
          >
            Baixar log OK
          </button>
          <button
            className="btn"
            disabled={!result?.errLog.length}
            onClick={() =>
              downloadJsonl(`import-err-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`, result?.errLog ?? [])
            }
          >
            Baixar log ERRO
          </button>
        </div>

        {stats ? (
          <div className="kpis" style={{ padding: "0 16px 16px" }}>
            <div className="kpi">
              <span>Processadas</span>
              <strong>{stats.processed}</strong>
            </div>
            <div className="kpi">
              <span>OK</span>
              <strong>{stats.ok}</strong>
            </div>
            <div className="kpi">
              <span>Erro</span>
              <strong>{stats.err}</strong>
            </div>
            <div className="kpi">
              <span>Skip</span>
              <strong>{stats.skip}</strong>
            </div>
            <div className="kpi">
              <span>DupSkip</span>
              <strong>{stats.dupSkip}</strong>
            </div>
            <div className="kpi">
              <span>HeaderRow</span>
              <strong>{stats.headerRowNum ?? "—"}</strong>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h3>Log de execução</h3>
        <textarea
          readOnly
          value={logText}
          style={{
            width: "100%",
            minHeight: 280,
            fontFamily: "Consolas, monospace",
            fontSize: 12,
            margin: "0 16px 16px",
            boxSizing: "border-box",
          }}
        />
      </section>
    </>
  );
}
