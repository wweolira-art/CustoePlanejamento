import { useApp } from "../store";
import { api } from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";

export function SheetManager() {
  const { sheets, reload, go } = useApp();

  return (
    <div className="page">
      <p className="lead">
        Oculte ou exclua abas que não entram neste orçamento. Premissas permanecem — as demais
        abas dependem delas. Tudo fica no SQLite.
      </p>
      <ReadOnlyFieldset>
      <section className="panel">
        <h3>Abas do sistema</h3>
        <table className="data">
          <thead>
            <tr>
              <th>Aba</th>
              <th>Tipo</th>
              <th>Visível</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sheets.map((s) => (
              <tr key={s.id}>
                <td className="desc">{s.title}</td>
                <td>{s.kind === "cost_center" ? "Centro de custo" : s.kind}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(s.visible)}
                    onChange={async (e) => {
                      await api.setVisible(s.id, e.target.checked);
                      await reload();
                    }}
                  />
                </td>
                <td>
                  {s.kind === "premissas" ? (
                    "—"
                  ) : (
                    <button
                      className="btn danger"
                      onClick={async () => {
                        if (!confirm(`Excluir a aba “${s.title}” e todas as linhas?`)) return;
                        await api.removeSheet(s.id);
                        await reload();
                        go({ kind: "manage" });
                      }}
                    >
                      Remover
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <button
        className="btn"
        onClick={async () => {
          if (!confirm("Recarregar a planilha original? Isso apaga inclusões feitas no sistema.")) return;
          await api.reset();
          await reload();
        }}
      >
        Restaurar planilha original
      </button>
      </ReadOnlyFieldset>
    </div>
  );
}
