import { useApp } from "../store";

export function SafraSelect({ variant }: { variant: "side" | "top" }) {
  const { page, safras, safraId, selectSafra, go } = useApp();
  const view =
    page.kind === "costPlanning"
      ? page.view
      : page.kind === "siteGroup"
        ? page.costView
        : null;
  if (view?.tab !== "sheet" && view?.tab !== "resumo" && view?.tab !== "orcadoRealizado" && view?.tab !== "dash") {
    return null;
  }

  return (
    <select
      className={variant === "side" ? "safra-pick side" : "safra-pick"}
      value={safraId || ""}
      aria-label="Safra em uso"
      onChange={(e) => {
        const value = e.target.value;
        if (value === "__new__") {
          go({ kind: "safras" });
          return;
        }
        void selectSafra(Number(value));
      }}
    >
      {safras.map((row) => (
        <option key={row.id} value={row.id}>
          {row.label}
        </option>
      ))}
      <option value="__new__">+ Nova safra…</option>
    </select>
  );
}
