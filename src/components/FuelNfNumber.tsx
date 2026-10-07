import { useEffect, useState } from "react";
import { api, type ContractFuelReport } from "../api";

export function FuelNfNumber({
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
  const [numero, setNumero] = useState(value);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => setNumero(value), [value]);

  async function salvar() {
    const next = numero.trim();
    if (!next) {
      setNumero(value);
      onError("Informe o número da NF.");
      return;
    }
    if (next === value) return;
    setSalvando(true);
    onError("");
    try {
      onChange(await api.updateContractFuelNote(noteId, { numeroNf: next }));
    } catch (err) {
      setNumero(value);
      onError(err instanceof Error ? err.message : "Não foi possível alterar o número da NF.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <input
      className="contract-fuel-nf"
      value={numero}
      disabled={salvando}
      aria-label="Número da NF"
      onChange={(event) => setNumero(event.target.value)}
      onBlur={() => void salvar()}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
    />
  );
}
