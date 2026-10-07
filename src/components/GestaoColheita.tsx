import { useState } from "react";
import { EntradaCanaImport } from "./EntradaCanaImport";
import { ColheitaAssociarEquipamento } from "./colheita/ColheitaAssociarEquipamento";
import { ColheitaAssociarFazenda } from "./colheita/ColheitaAssociarFazenda";
import { ColheitaEncerramentoOrdens } from "./colheita/ColheitaEncerramentoOrdens";
import { ColheitaEntradaCaminhao } from "./colheita/ColheitaEntradaCaminhao";
import { ColheitaEntradaMaquina } from "./colheita/ColheitaEntradaMaquina";
import { ColheitaHorasMaquina } from "./colheita/ColheitaHorasMaquina";
import { ColheitaLiberacao } from "./colheita/ColheitaLiberacao";
import { ColheitaResumoTransporte } from "./colheita/ColheitaResumoTransporte";

export type GestaoColheitaTab =
  | "entrada-caminhao"
  | "entrada-maquina"
  | "associar-equipamento"
  | "horas-maquina"
  | "associar-fazenda"
  | "encerramento-ordens"
  | "liberacao-colheita"
  | "resumo-transporte"
  | "import";

const TABS: { id: GestaoColheitaTab; label: string }[] = [
  { id: "entrada-caminhao", label: "Entrada cana caminhão" },
  { id: "entrada-maquina", label: "Entrada cana máquina" },
  { id: "associar-equipamento", label: "Associar equipamento" },
  { id: "horas-maquina", label: "Horas máquina" },
  { id: "associar-fazenda", label: "Associar fazenda" },
  { id: "encerramento-ordens", label: "Encerrar ordens colheita" },
  { id: "liberacao-colheita", label: "Liberação de colheita" },
  { id: "resumo-transporte", label: "Resumo transporte cana" },
  { id: "import", label: "Importar planilha" },
];

export const GESTAO_COLHEITA_TABS = TABS;

export function GestaoColheitaNativePanel({ tab }: { tab: GestaoColheitaTab }) {
  return (
    <>
      {tab === "entrada-caminhao" ? <ColheitaEntradaCaminhao /> : null}
      {tab === "entrada-maquina" ? <ColheitaEntradaMaquina /> : null}
      {tab === "associar-equipamento" ? <ColheitaAssociarEquipamento /> : null}
      {tab === "horas-maquina" ? <ColheitaHorasMaquina /> : null}
      {tab === "associar-fazenda" ? <ColheitaAssociarFazenda /> : null}
      {tab === "encerramento-ordens" ? <ColheitaEncerramentoOrdens /> : null}
      {tab === "liberacao-colheita" ? <ColheitaLiberacao /> : null}
      {tab === "resumo-transporte" ? <ColheitaResumoTransporte /> : null}
      {tab === "import" ? <EntradaCanaImport /> : null}
    </>
  );
}

/** @deprecated Use SiteGroupPage com grupo gestao-colheita */
export function GestaoColheita() {
  const [tab, setTab] = useState<GestaoColheitaTab>("entrada-caminhao");
  return (
    <div className="page">
      <div className="kind-toggle" style={{ paddingBottom: 4, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn ${tab === t.id ? "primary" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <GestaoColheitaNativePanel tab={tab} />
    </div>
  );
}
