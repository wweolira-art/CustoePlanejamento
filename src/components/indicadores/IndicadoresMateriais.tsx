import { useState } from "react";
import { MaterialsEntradaSaidaReport } from "../MaterialsEntradaSaidaReport";
import { IndicadoresGestaoMateriais } from "./IndicadoresGestaoMateriais";

type MateriaisView = "gestao" | "entrada-saida";

export function IndicadoresMateriais() {
  const [view, setView] = useState<MateriaisView>("gestao");

  return (
    <>
      <div className="kind-toggle no-print" style={{ marginBottom: 10 }}>
        <button type="button" className={`btn ${view === "gestao" ? "primary" : ""}`} onClick={() => setView("gestao")}>
          Gestão de estoque
        </button>
        <button
          type="button"
          className={`btn ${view === "entrada-saida" ? "primary" : ""}`}
          onClick={() => setView("entrada-saida")}
        >
          Entrada × saída
        </button>
      </div>
      {view === "gestao" ? <IndicadoresGestaoMateriais /> : <MaterialsEntradaSaidaReport />}
    </>
  );
}
