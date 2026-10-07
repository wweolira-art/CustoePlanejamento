import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type SeedFarmRadius, type SeedFarmTrip } from "../api";
import { formatQty } from "../lib/format";
import { ConsultaProgressBar } from "./ConsultaProgressBar";
import { useApp } from "../store";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(year: number, month0: number, day: number) {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`;
}

function safraRange(code?: string) {
  const match = code?.match(/^(\d{2})\//);
  const yy = match ? Number(match[1]) : new Date().getFullYear() % 100;
  const startYear = yy >= 90 ? 1900 + yy : 2000 + yy;
  return {
    from: isoDate(startYear, 8, 1),
    to: isoDate(startYear + 1, 7, 31),
  };
}

function formatDay(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString("pt-BR");
}

function km(value: number | null | undefined) {
  if (value == null) return "—";
  return `${formatQty(value)} km`;
}

export function SeedRadius() {
  const { safra } = useApp();
  const defaults = safraRange(safra?.code);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [q, setQ] = useState("");
  const [onlyWithTrips, setOnlyWithTrips] = useState(true);
  const [farms, setFarms] = useState<SeedFarmRadius[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openFarm, setOpenFarm] = useState<number | null>(null);
  const [trips, setTrips] = useState<SeedFarmTrip[]>([]);
  const [tripsErr, setTripsErr] = useState<string | null>(null);
  const [tripsLoading, setTripsLoading] = useState(false);

  useEffect(() => {
    const range = safraRange(safra?.code);
    setFrom(range.from);
    setTo(range.to);
  }, [safra?.code]);

  const filtered = useMemo(() => {
    const raw = q.trim().toLowerCase();
    return farms.filter((farm) => {
      if (onlyWithTrips && !farm.trips) return false;
      if (!raw) return true;
      return `${farm.farmCode} ${farm.farmName}`.toLowerCase().includes(raw);
    });
  }, [farms, q, onlyWithTrips]);

  const totals = useMemo(() => {
    const withRadius = filtered.filter((farm) => farm.averageKm != null && farm.trips > 0);
    if (!withRadius.length) return null;
    const farmAvg = withRadius.reduce((sum, farm) => sum + (farm.averageKm ?? 0), 0) / withRadius.length;
    const trips = withRadius.reduce((sum, farm) => sum + farm.trips, 0);
    const weighted = trips
      ? withRadius.reduce((sum, farm) => sum + (farm.averageKm ?? 0) * farm.trips, 0) / trips
      : null;
    const cadastral = withRadius.filter((farm) => farm.cadastralKm != null);
    const cadastralAvg = cadastral.length
      ? cadastral.reduce((sum, farm) => sum + (farm.cadastralKm ?? 0), 0) / cadastral.length
      : null;
    return {
      farmAvg,
      weighted,
      cadastralAvg,
      farms: withRadius.length,
      trips,
      minKm: Math.min(...withRadius.map((farm) => farm.minKm ?? farm.averageKm ?? 0)),
      maxKm: Math.max(...withRadius.map((farm) => farm.maxKm ?? farm.averageKm ?? 0)),
    };
  }, [filtered]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    setOpenFarm(null);
    setTrips([]);
    try {
      const data = await api.seedRadius(from, to);
      setFarms(data.farms);
    } catch (e) {
      setFarms([]);
      setErr(e instanceof Error ? e.message : "Não foi possível consultar o Oracle.");
    } finally {
      setLoading(false);
    }
  };

  const openTrips = async (farm: SeedFarmRadius) => {
    if (openFarm === farm.farmCode) {
      setOpenFarm(null);
      setTrips([]);
      return;
    }
    setOpenFarm(farm.farmCode);
    setTripsLoading(true);
    setTripsErr(null);
    try {
      const data = await api.seedRadiusTrips(farm.farmCode, from, to);
      setTrips(data.trips);
    } catch (e) {
      setTrips([]);
      setTripsErr(e instanceof Error ? e.message : "Não foi possível ler os apontamentos.");
    } finally {
      setTripsLoading(false);
    }
  };

  return (
    <>
      <p className="lead">
        Distância média de transporte de semente por fazenda, a partir dos apontamentos da operação
        159. Informe o período, consulte o Oracle e compare o raio médio com a distância cadastrada
        em agricola.fazenda.
      </p>

      <section className="panel">
        <h3>Período dos apontamentos</h3>
        <div className="form-grid">
          <label>
            De
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Até
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label>
            Buscar fazenda
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código ou nome" />
          </label>
          <label className="check-label">
            <span className="check-row">
              <input
                type="checkbox"
                checked={onlyWithTrips}
                onChange={(e) => setOnlyWithTrips(e.target.checked)}
              />
              Só fazendas com apontamento no período
            </span>
          </label>
        </div>
        {err ? <p className="lead" style={{ padding: "0 16px", color: "var(--danger)" }}>{err}</p> : null}
        <div className="modal-actions" style={{ padding: "0 16px 16px" }}>
          <button className="btn primary" disabled={loading} onClick={() => void load()}>
            {loading ? "Consultando Oracle…" : "Calcular média por fazenda"}
          </button>
        </div>
        <ConsultaProgressBar active={loading} label="Calculando média por fazenda…" className="consulta-progress--compact" />
      </section>

      {totals ? (
        <div className="kpis">
          <div className="kpi">
            <span>Média de todas as fazendas</span>
            <strong>{km(totals.farmAvg)}</strong>
          </div>
          <div className="kpi">
            <span>Média dos apontamentos</span>
            <strong>{km(totals.weighted)}</strong>
          </div>
          <div className="kpi">
            <span>Média do cadastro</span>
            <strong>{km(totals.cadastralAvg)}</strong>
          </div>
          <div className="kpi">
            <span>Fazendas / apontamentos</span>
            <strong>
              {totals.farms} / {totals.trips}
            </strong>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <h3>
          Fazendas
          <small>{filtered.length}</small>
        </h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Fazenda</th>
                <th>Distância cadastro</th>
                <th>Raio médio</th>
                <th>Mín.</th>
                <th>Máx.</th>
                <th>Apontamentos</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((farm) => (
                <Fragment key={farm.farmCode}>
                  <tr
                    className={openFarm === farm.farmCode ? "copied-row" : ""}
                    onClick={() => void openTrips(farm)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{farm.farmCode}</td>
                    <td className="left desc">{farm.farmName}</td>
                    <td>{km(farm.cadastralKm)}</td>
                    <td>{km(farm.averageKm)}</td>
                    <td>{km(farm.minKm)}</td>
                    <td>{km(farm.maxKm)}</td>
                    <td>{farm.trips || "—"}</td>
                  </tr>
                  {openFarm === farm.farmCode ? (
                    <tr>
                      <td className="left" colSpan={7}>
                        {tripsLoading ? (
                          "Carregando apontamentos…"
                        ) : tripsErr ? (
                          <span style={{ color: "var(--danger)" }}>{tripsErr}</span>
                        ) : !trips.length ? (
                          "Nenhum apontamento neste período."
                        ) : (
                          <table className="data">
                            <thead>
                              <tr>
                                <th>Data</th>
                                <th>Origem</th>
                                <th>Destino</th>
                                <th>Distância</th>
                                <th>Quantidade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {trips.map((trip, i) => (
                                <tr key={`${farm.farmCode}-${i}`}>
                                  <td>{formatDay(trip.date)}</td>
                                  <td className="left">
                                    {trip.originCode ?? "—"} {trip.originName}
                                  </td>
                                  <td className="left">
                                    {trip.destCode ?? "—"} {trip.destName}
                                  </td>
                                  <td>{km(trip.distanceKm)}</td>
                                  <td>{trip.quantity != null ? formatQty(trip.quantity) : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!filtered.length ? (
                <tr>
                  <td className="left" colSpan={7}>
                    {farms.length
                      ? "Nenhuma fazenda neste filtro."
                      : "Escolha o período e clique em calcular média por fazenda."}
                  </td>
                </tr>
              ) : totals ? (
                <tr className="total">
                  <td />
                  <td className="left">Média de todas as fazendas</td>
                  <td>{km(totals.cadastralAvg)}</td>
                  <td>{km(totals.farmAvg)}</td>
                  <td>{km(totals.minKm)}</td>
                  <td>{km(totals.maxKm)}</td>
                  <td>{totals.trips}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
