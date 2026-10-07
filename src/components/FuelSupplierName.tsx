import { useEffect, useState } from "react";
import { api, type ContractFuelReport } from "../api";

export function FuelSupplierName({
  noteId,
  value,
  onChange,
  onError,
}: {
  noteId: number;
  value: string;
  onChange: (report: ContractFuelReport) => void;
  onError: (message: string) => void;
}) {
  const [nome, setNome] = useState(value);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setNome(value), [value]);

  async function salvar() {
    const next = nome.trim();
    if (!next) {
      setNome(value);
      onError("Informe o fornecedor.");
      return;
    }
    if (next === value) return;
    setSalvando(true);
    onError("");
    try {
      onChange(await api.updateContractFuelNote(noteId, { fornecedor: next }));
    } catch (err) {
      setNome(value);
      onError(err instanceof Error ? err.message : "Não foi possível alterar o fornecedor.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <input
      className="contract-fuel-fornecedor"
      value={nome}
      disabled={salvando}
      aria-label="Fornecedor"
      onChange={(event) => setNome(event.target.value)}
      onBlur={() => void salvar()}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}
