import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  api,
  embedGroupLabel,
  EXTERNAL_EMBED_TARGETS,
  isSidebarSiteGroup,
  type ExternalSiteEmbedNativeKey,
  type ExternalSiteGroup,
} from "../api";
import { ReadOnlyFieldset } from "../lib/editAccess";
import { nativeTabsForGroup } from "../lib/nativeEmbedTabs";

type Destination =
  | { kind: "embed"; nativeKey: ExternalSiteEmbedNativeKey }
  | { kind: "group"; groupId: number }
  | { kind: "new" };

function destinationFromValue(value: string, groups: ExternalSiteGroup[]): Destination {
  if (value.startsWith("embed:")) {
    const nativeKey = value.slice("embed:".length) as ExternalSiteEmbedNativeKey;
    if (EXTERNAL_EMBED_TARGETS.some((row) => row.nativeKey === nativeKey)) {
      return { kind: "embed", nativeKey };
    }
  }
  if (value.startsWith("group:")) {
    const groupId = Number(value.slice("group:".length));
    if (groups.some((group) => group.id === groupId)) return { kind: "group", groupId };
  }
  return { kind: "new" };
}

function destinationValueForGroup(group: ExternalSiteGroup): string {
  if (group.nativeKey && EXTERNAL_EMBED_TARGETS.some((row) => row.nativeKey === group.nativeKey)) {
    return `embed:${group.nativeKey}`;
  }
  return `group:${group.id}`;
}

function DestinationSelect({
  value,
  sidebarGroups,
  disabled,
  onChange,
}: {
  value: string;
  sidebarGroups: ExternalSiteGroup[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <optgroup label="Abas existentes do sistema">
        {EXTERNAL_EMBED_TARGETS.map((target) => (
          <option key={target.nativeKey} value={`embed:${target.nativeKey}`}>
            {target.label}
          </option>
        ))}
      </optgroup>
      {sidebarGroups.length ? (
        <optgroup label="Abas no menu lateral">
          {sidebarGroups.map((group) => (
            <option key={group.id} value={`group:${group.id}`}>
              {group.label}
            </option>
          ))}
        </optgroup>
      ) : null}
      <option value="new">Nova aba no menu lateral</option>
    </select>
  );
}

export function ExternalSitesAdmin({ onChanged }: { onChanged?: () => void }) {
  const [groups, setGroups] = useState<ExternalSiteGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [destinationValueRaw, setDestinationValueRaw] = useState("embed:cost-planning");
  const [tabLabel, setTabLabel] = useState("");
  const [subTabLabel, setSubTabLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [movingItemId, setMovingItemId] = useState<number | null>(null);

  const destination = useMemo(
    () => destinationFromValue(destinationValueRaw, groups),
    [destinationValueRaw, groups],
  );

  const sidebarGroups = useMemo(() => groups.filter(isSidebarSiteGroup), [groups]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setGroups(await api.externalSitesAdmin());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível carregar os sites.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      if (destination.kind === "embed") {
        await api.registerExternalSite({
          embedNativeKey: destination.nativeKey,
          subTabLabel,
          url,
        });
      } else if (destination.kind === "group") {
        await api.registerExternalSite({
          groupId: destination.groupId,
          subTabLabel,
          url,
        });
      } else {
        await api.registerExternalSite({ tabLabel, subTabLabel, url });
      }
      setSubTabLabel("");
      setUrl("");
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível cadastrar o site.");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: number) {
    if (!confirm("Excluir esta subaba?")) return;
    setErr(null);
    try {
      await api.deleteExternalSiteItem(id);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível excluir.");
    }
  }

  async function moveItem(itemId: number, value: string) {
    const dest = destinationFromValue(value, groups);
    setMovingItemId(itemId);
    setErr(null);
    try {
      if (dest.kind === "embed") {
        await api.updateExternalSiteItem(itemId, { embedNativeKey: dest.nativeKey });
      } else if (dest.kind === "group") {
        await api.updateExternalSiteItem(itemId, { groupId: dest.groupId });
      } else {
        const newTabLabel = window.prompt("Nome da nova aba no menu lateral:");
        if (!newTabLabel?.trim()) return;
        await api.updateExternalSiteItem(itemId, { tabLabel: newTabLabel.trim() });
      }
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível alterar o destino.");
    } finally {
      setMovingItemId(null);
    }
  }

  async function removeGroup(id: number, label: string) {
    if (!confirm(`Excluir a aba "${label}" e todas as subabas?`)) return;
    setErr(null);
    try {
      await api.deleteExternalSiteGroup(id);
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível excluir a aba.");
    }
  }

  async function toggleNativeTab(nativeKey: string, tabId: string, hidden: boolean) {
    setErr(null);
    try {
      await api.setNativeTabHidden({ nativeKey, tabId, hidden });
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível atualizar a subaba.");
    }
  }

  return (
    <div className="page">
      <h2 style={{ marginBottom: 8 }}>Sites incorporados</h2>
      <p className="lead" style={{ marginTop: 0 }}>
        Cadastre um site externo escolhendo o <strong>destino</strong> (aba existente do sistema ou nova aba no menu),
        a <strong>subaba</strong> (botão no topo da tela) e a URL. Nas abas nativas, use <strong>Ocultar</strong> para
        excluir subabas do menu — por exemplo Indicadores → Combustível.
      </p>

      <ReadOnlyFieldset>
        <form className="form-grid external-sites-form" onSubmit={(e) => void submit(e)}>
          <label className="span-2">
            Destino
            <DestinationSelect
              value={destinationValueRaw}
              sidebarGroups={sidebarGroups}
              disabled={saving}
              onChange={setDestinationValueRaw}
            />
          </label>
          {destination.kind === "new" ? (
            <label className="span-2">
              Aba (menu lateral)
              <input
                value={tabLabel}
                onChange={(e) => setTabLabel(e.target.value)}
                placeholder="Ex.: Orca Safra"
                disabled={saving}
              />
            </label>
          ) : null}
          <label>
            Subaba
            <input
              value={subTabLabel}
              onChange={(e) => setSubTabLabel(e.target.value)}
              placeholder="Ex.: Entrada de cana caminhão"
              disabled={saving}
            />
          </label>
          <label>
            Site (URL)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Ex.: entradadecanacaminhao.com.br ou https://orcasafra.vercel.app/"
              disabled={saving}
            />
          </label>
          <div className="span-2">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Salvando…" : "Cadastrar site"}
            </button>
          </div>
        </form>

        {err ? (
          <p className="lead" style={{ color: "var(--danger)" }}>
            {err}
          </p>
        ) : null}

        {loading ? <p className="lead">Carregando…</p> : null}

        <div className="external-sites-list">
          {groups.map((group) => (
            <section key={group.id} className="card external-sites-group">
              <header className="external-sites-group-head">
                <div>
                  <h3>{group.label}</h3>
                  <p className="meta">
                    {embedGroupLabel(group)} · slug: {group.slug}
                  </p>
                </div>
                {!group.nativeKey ? (
                  <button type="button" className="btn" onClick={() => void removeGroup(group.id, group.label)}>
                    Excluir aba
                  </button>
                ) : null}
              </header>
              {(() => {
                const nativeTabs = nativeTabsForGroup(group.nativeKey);
                const hidden = new Set(group.hiddenNativeTabs ?? []);
                if (!nativeTabs.length) return null;
                return (
                  <table className="data-table" style={{ marginBottom: group.items.length ? 16 : 0 }}>
                    <thead>
                      <tr>
                        <th>Subaba do sistema</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {nativeTabs.map((tab) => {
                        const hiddenNow = hidden.has(tab.id);
                        return (
                          <tr key={tab.id} className={hiddenNow ? "is-hidden-tab" : undefined}>
                            <td>{tab.label}</td>
                            <td>{hiddenNow ? "Oculta" : "Visível"}</td>
                            <td>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => void toggleNativeTab(group.nativeKey!, tab.id, !hiddenNow)}
                              >
                                {hiddenNow ? "Exibir" : "Ocultar"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
              {group.items.length ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Subaba</th>
                      <th>Destino</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.label}</td>
                        <td>
                          <DestinationSelect
                            value={destinationValueForGroup(group)}
                            sidebarGroups={sidebarGroups}
                            disabled={movingItemId === item.id}
                            onChange={(value) => {
                              if (value === destinationValueForGroup(group)) return;
                              void moveItem(item.id, value);
                            }}
                          />
                        </td>
                        <td>
                          <button type="button" className="btn" onClick={() => void removeItem(item.id)}>
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : nativeTabsForGroup(group.nativeKey).length ? null : (
                <p className="lead" style={{ margin: 0 }}>
                  Nenhuma subaba cadastrada.
                </p>
              )}
            </section>
          ))}
        </div>
      </ReadOnlyFieldset>
    </div>
  );
}
