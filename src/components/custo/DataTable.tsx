import { formatConsultaValue, type DataColumn } from "../../lib/consultaRateioColumns";

type Row = Record<string, unknown>;

export function DataTable({
  columns,
  rows,
  emptyMessage = "Nenhum registro.",
  footerRow,
}: {
  columns: DataColumn[];
  rows: Row[];
  emptyMessage?: string;
  footerRow?: Row | null;
}) {
  return (
    <div className="table-wrap">
      <table className="data cost-center">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.num ? "num" : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, idx) => (
              <tr key={idx}>
                {columns.map((col) => (
                  <td key={col.key} className={col.num ? "num" : undefined}>
                    {formatConsultaValue(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          )}
        </tbody>
        {footerRow ? (
          <tfoot>
            <tr className="data-subtotal">
              {columns.map((col) => (
                <td key={col.key} className={col.num ? "num" : undefined}>
                  <strong>{formatConsultaValue(footerRow[col.key], col.format)}</strong>
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
