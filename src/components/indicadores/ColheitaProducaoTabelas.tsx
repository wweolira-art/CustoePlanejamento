import type { IndicadoresProducaoLinha } from "../../api";

function fmt2(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function ThQuebra({ lines }: { lines: string[] }) {
  return (
    <th className="num indicadores-th-break">
      {lines.map((line, index) => (
        <span key={`${line}-${index}`}>
          {index > 0 ? <br /> : null}
          {line}
        </span>
      ))}
    </th>
  );
}

function dispPct(linhas: IndicadoresProducaoLinha[]) {
  const horasPotenciais = linhas.reduce((acc, row) => acc + (row.horasPotenciais ?? 0), 0);
  const horasOficina = linhas.reduce((acc, row) => acc + (row.horasOficina ?? 0), 0);
  if (horasPotenciais > 0) return (Math.max(horasPotenciais - horasOficina, 0) / horasPotenciais) * 100;
  const withPct = linhas.filter((row) => row.disponibilidadePct != null);
  if (!withPct.length) return null;
  return withPct.reduce((acc, row) => acc + (row.disponibilidadePct ?? 0), 0) / withPct.length;
}

function CelulaDisponibilidade({ pct }: { pct: number | null | undefined }) {
  if (pct == null || !Number.isFinite(pct)) return <td className="num">—</td>;
  const tone = pct < 85 ? "indicadores-parado-cell" : "indicadores-rodando-cell";
  return <td className={`num ${tone}`}>{fmt2(pct)}%</td>;
}

function CelulaDisponibilidadeTotal({
  linhas,
  totais,
}: {
  linhas: IndicadoresProducaoLinha[];
  totais: IndicadoresProducaoLinha | null;
}) {
  const pct = totais?.disponibilidadePct ?? dispPct(linhas);
  return (
    <td className="num">
      <strong>{pct == null ? "—" : `${fmt2(pct)}%`}</strong>
    </td>
  );
}

export function TabelaColhedora({
  linhas,
  totais,
  ocultarLitrosCombustivel = false,
  ocultarHorasMotorElevador = false,
  mostrarDisponibilidade = false,
}: {
  linhas: IndicadoresProducaoLinha[];
  totais: IndicadoresProducaoLinha | null;
  ocultarLitrosCombustivel?: boolean;
  ocultarHorasMotorElevador?: boolean;
  mostrarDisponibilidade?: boolean;
}) {
  return (
    <table className="data indicadores-producao-table">
      <thead>
        <tr>
          <th>Frota</th>
          {mostrarDisponibilidade ? <ThQuebra lines={["Disponi-", "bilidade"]} /> : null}
          <ThQuebra lines={["Tonelada", "Colhida"]} />
          {ocultarLitrosCombustivel ? null : <th className="num">Litros Combustível</th>}
          {ocultarHorasMotorElevador ? null : <th className="num">Hrs Motor</th>}
          {ocultarHorasMotorElevador ? null : <th className="num">Hrs Elevador</th>}
          <th className="num">Lt/ton</th>
          <th className="num">Lt/hr</th>
          <ThQuebra lines={["Ton/hr", "Motor"]} />
          <ThQuebra lines={["Ton/hr", "Elevador"]} />
          <th className="num">Ton/dia</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((row) => (
          <tr key={row.equipTag} className={row.parado ? "indicadores-parado" : ""}>
            <td>{row.equipTag}</td>
            {mostrarDisponibilidade ? <CelulaDisponibilidade pct={row.disponibilidadePct} /> : null}
            <td className="num">{fmt2(row.toneladaColhida)}</td>
            {ocultarLitrosCombustivel ? null : <td className="num">{fmt2(row.litrosCombustivel)}</td>}
            {ocultarHorasMotorElevador ? null : <td className="num">{fmt2(row.hrsMotor)}</td>}
            {ocultarHorasMotorElevador ? null : <td className="num">{fmt2(row.hrsElevador)}</td>}
            <td className="num">{fmt2(row.ltTon)}</td>
            <td className="num">{fmt2(row.ltHr)}</td>
            <td className="num">{fmt2(row.tonHrMotor)}</td>
            <td className="num">{fmt2(row.tonHrElevador)}</td>
            <td className="num">{fmt2(row.tonDia)}</td>
          </tr>
        ))}
        {totais ? (
          <tr className="indicadores-producao-total">
            <td>
              <strong>Total</strong>
            </td>
            {mostrarDisponibilidade ? <CelulaDisponibilidadeTotal linhas={linhas} totais={totais} /> : null}
            <td className="num">
              <strong>{fmt2(totais.toneladaColhida)}</strong>
            </td>
            {ocultarLitrosCombustivel ? null : (
              <td className="num">
                <strong>{fmt2(totais.litrosCombustivel)}</strong>
              </td>
            )}
            {ocultarHorasMotorElevador ? null : (
              <td className="num">
                <strong>{fmt2(totais.hrsMotor)}</strong>
              </td>
            )}
            {ocultarHorasMotorElevador ? null : (
              <td className="num">
                <strong>{fmt2(totais.hrsElevador)}</strong>
              </td>
            )}
            <td className="num">
              <strong>{fmt2(totais.ltTon)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.ltHr)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.tonHrMotor)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.tonHrElevador)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.tonDia)}</strong>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export function TabelaTrator({
  linhas,
  totais,
  ocultarLitrosCombustivel = false,
  ocultarHorasMotorElevador = false,
  mostrarDisponibilidade = false,
}: {
  linhas: IndicadoresProducaoLinha[];
  totais: IndicadoresProducaoLinha | null;
  ocultarLitrosCombustivel?: boolean;
  ocultarHorasMotorElevador?: boolean;
  mostrarDisponibilidade?: boolean;
}) {
  return (
    <table className="data indicadores-producao-table">
      <thead>
        <tr>
          <th>Frota</th>
          {mostrarDisponibilidade ? <ThQuebra lines={["Disponi-", "bilidade"]} /> : null}
          <ThQuebra lines={["Tonelada", "Colhida"]} />
          {ocultarLitrosCombustivel ? null : <th className="num">Litros Combustível</th>}
          {ocultarHorasMotorElevador ? null : <th className="num">Hrs Motor</th>}
          <th className="num">Lt/ton</th>
          <th className="num">Lt/hr</th>
          <ThQuebra lines={["Ton/hora", "Motor"]} />
          <ThQuebra lines={["Ton/dia/", "maquina"]} />
        </tr>
      </thead>
      <tbody>
        {linhas.map((row) => (
          <tr key={row.equipTag} className={row.parado ? "indicadores-parado" : ""}>
            <td>{row.equipTag}</td>
            {mostrarDisponibilidade ? <CelulaDisponibilidade pct={row.disponibilidadePct} /> : null}
            <td className="num">{fmt2(row.toneladaColhida)}</td>
            {ocultarLitrosCombustivel ? null : <td className="num">{fmt2(row.litrosCombustivel)}</td>}
            {ocultarHorasMotorElevador ? null : <td className="num">{fmt2(row.hrsMotor)}</td>}
            <td className="num">{fmt2(row.ltTon)}</td>
            <td className="num">{fmt2(row.ltHr)}</td>
            <td className="num">{fmt2(row.tonHrMotor)}</td>
            <td className="num">{fmt2(row.tonDia)}</td>
          </tr>
        ))}
        {totais ? (
          <tr className="indicadores-producao-total">
            <td>
              <strong>Total</strong>
            </td>
            {mostrarDisponibilidade ? <CelulaDisponibilidadeTotal linhas={linhas} totais={totais} /> : null}
            <td className="num">
              <strong>{fmt2(totais.toneladaColhida)}</strong>
            </td>
            {ocultarLitrosCombustivel ? null : (
              <td className="num">
                <strong>{fmt2(totais.litrosCombustivel)}</strong>
              </td>
            )}
            {ocultarHorasMotorElevador ? null : (
              <td className="num">
                <strong>{fmt2(totais.hrsMotor)}</strong>
              </td>
            )}
            <td className="num">
              <strong>{fmt2(totais.ltTon)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.ltHr)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.tonHrMotor)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.tonDia)}</strong>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export function TabelaCaminhao({
  linhas,
  totais,
  ocultarLitrosCombustivel = false,
  ocultarKmRodados = false,
  mostrarDisponibilidade = false,
}: {
  linhas: IndicadoresProducaoLinha[];
  totais: IndicadoresProducaoLinha | null;
  ocultarLitrosCombustivel?: boolean;
  ocultarKmRodados?: boolean;
  mostrarDisponibilidade?: boolean;
}) {
  return (
    <table className="data indicadores-producao-table">
      <thead>
        <tr>
          <th>Frota</th>
          {mostrarDisponibilidade ? <ThQuebra lines={["Disponi-", "bilidade"]} /> : null}
          <ThQuebra lines={["Tonelada", "Colhida"]} />
          {ocultarLitrosCombustivel ? null : <th className="num">Litros Combustível</th>}
          {ocultarKmRodados ? null : <th className="num">Km rodados</th>}
          <th className="num">Km/lt</th>
          <th className="num">Lt/ton</th>
          <th className="num">Ton/viagem</th>
          <th className="num">Media diária</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((row) => (
          <tr key={row.equipTag} className={row.parado ? "indicadores-parado" : ""}>
            <td>{row.equipTag}</td>
            {mostrarDisponibilidade ? <CelulaDisponibilidade pct={row.disponibilidadePct} /> : null}
            <td className="num">{fmt2(row.toneladaColhida)}</td>
            {ocultarLitrosCombustivel ? null : <td className="num">{fmt2(row.litrosCombustivel)}</td>}
            {ocultarKmRodados ? null : <td className="num">{fmt2(row.kmRodados)}</td>}
            <td className="num">{fmt2(row.kmLt)}</td>
            <td className="num">{fmt2(row.ltTon)}</td>
            <td className="num">{fmt2(row.tonViagem)}</td>
            <td className="num">{fmt2(row.mediaDiaria)}</td>
          </tr>
        ))}
        {totais ? (
          <tr className="indicadores-producao-total">
            <td>
              <strong>Total</strong>
            </td>
            {mostrarDisponibilidade ? <CelulaDisponibilidadeTotal linhas={linhas} totais={totais} /> : null}
            <td className="num">
              <strong>{fmt2(totais.toneladaColhida)}</strong>
            </td>
            {ocultarLitrosCombustivel ? null : (
              <td className="num">
                <strong>{fmt2(totais.litrosCombustivel)}</strong>
              </td>
            )}
            {ocultarKmRodados ? null : (
              <td className="num">
                <strong>{fmt2(totais.kmRodados)}</strong>
              </td>
            )}
            <td className="num">
              <strong>{fmt2(totais.kmLt)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.ltTon)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.tonViagem)}</strong>
            </td>
            <td className="num">
              <strong>{fmt2(totais.mediaDiaria)}</strong>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}
