import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { api, type AdminUserRow, type ExternalSiteGroup, type SheetInfo } from "../api";
import {
  COST_PLANNING_TABS,
  editPermissionKey,
  groupInnerScreens,
  isGroupInnerChecked,
  isGroupInnerEditChecked,
  PAGE_PERMISSIONS,
  PERMISSION_ADMIN,
  setEditPermission,
  setGroupInnerEdit,
  setGroupInnerView,
  setViewPermission,
  sheetPermissionKey,
  siteGroupPermissionKey,
} from "../lib/permissions";
import { ReadOnlyFieldset } from "../lib/editAccess";
import { useApp } from "../store";

function AccessRow({
  label,
  viewKey,
  selected,
  onChange,
}: {
  label: string;
  viewKey: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const hasView = selected.includes(viewKey);
  const hasEdit = selected.includes(editPermissionKey(viewKey));
  return (
    <div className="permission-row">
      <span className="permission-row-label">{label}</span>
      <label className="check-label permission-row-check">
        <span className="check-row">
          <input
            type="checkbox"
            checked={hasView}
            onChange={(e) => onChange(setViewPermission(selected, viewKey, e.target.checked))}
          />
          Ver
        </span>
      </label>
      <label className="check-label permission-row-check">
        <span className="check-row">
          <input
            type="checkbox"
            checked={hasEdit}
            disabled={!hasView}
            onChange={(e) => onChange(setEditPermission(selected, viewKey, e.target.checked))}
          />
          Editar
        </span>
      </label>
    </div>
  );
}

function PermissionPicker({
  selected,
  onChange,
  sheets,
  siteGroups,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  sheets: SheetInfo[];
  siteGroups: ExternalSiteGroup[];
}) {
  const centers = sheets.filter((sheet) => sheet.visible && sheet.kind === "cost_center");
  const unrestricted = selected.length === 0;

  return (
    <div className="permission-picker">
      <p className="lead" style={{ marginTop: 0 }}>
        {unrestricted
          ? "Sem restrições marcadas: o usuário acessa e edita todas as abas."
          : "Marque Ver na aba e, em seguida, as telas internas — por exemplo o que a pessoa pode abrir dentro de Indicadores."}
      </p>

      <label className="check-label">
        <span className="check-row">
          <input
            type="checkbox"
            checked={selected.includes(PERMISSION_ADMIN)}
            onChange={() =>
              onChange(
                selected.includes(PERMISSION_ADMIN)
                  ? selected.filter((key) => key !== PERMISSION_ADMIN)
                  : [...selected, PERMISSION_ADMIN],
              )
            }
          />
          Acesso total (administrador)
        </span>
      </label>

      <div className="permission-group">
        <div className="permission-table-head">
          <strong>Custo e Planejamento</strong>
          <span>Ver</span>
          <span>Editar</span>
        </div>
        {COST_PLANNING_TABS.map((tab) => (
          <AccessRow key={tab.key} label={tab.label} viewKey={tab.key} selected={selected} onChange={onChange} />
        ))}
      </div>

      {centers.length ? (
        <div className="permission-group">
          <div className="permission-table-head">
            <strong>Orçamentos</strong>
            <span>Ver</span>
            <span>Editar</span>
          </div>
          {centers.map((sheet) => (
            <AccessRow
              key={sheet.id}
              label={sheet.title}
              viewKey={sheetPermissionKey(sheet.id)}
              selected={selected}
              onChange={onChange}
            />
          ))}
        </div>
      ) : null}

      {siteGroups.length ? (
        <div className="permission-group">
          <div className="permission-table-head">
            <strong>Sites e colheita</strong>
            <span>Ver</span>
            <span>Editar</span>
          </div>
          {siteGroups.map((group) => {
            const inners = groupInnerScreens(group);
            const parentKey = siteGroupPermissionKey(group.id);
            const adminOn = selected.includes(PERMISSION_ADMIN);
            const parentOn = selected.includes(parentKey);
            return (
              <Fragment key={group.id}>
                <AccessRow
                  label={group.label}
                  viewKey={parentKey}
                  selected={selected}
                  onChange={(next) => {
                    if (next.includes(parentKey)) {
                      onChange(next);
                      return;
                    }
                    let cleared = next;
                    for (const inner of inners) {
                      cleared = setViewPermission(cleared, inner.key, false);
                    }
                    onChange(cleared);
                  }}
                />
                {inners.map((inner) => (
                  <div key={inner.key} className="permission-row is-nested">
                    <span className="permission-row-label">{inner.label}</span>
                    <label className="check-label permission-row-check">
                      <span className="check-row">
                        <input
                          type="checkbox"
                          checked={isGroupInnerChecked(selected, group, inner.key)}
                          disabled={adminOn || !parentOn}
                          onChange={(e) =>
                            onChange(setGroupInnerView(selected, group, inner.key, e.target.checked))
                          }
                        />
                        Ver
                      </span>
                    </label>
                    <label className="check-label permission-row-check">
                      <span className="check-row">
                        <input
                          type="checkbox"
                          checked={isGroupInnerEditChecked(selected, group, inner.key)}
                          disabled={
                            adminOn || !isGroupInnerChecked(selected, group, inner.key)
                          }
                          onChange={(e) =>
                            onChange(setGroupInnerEdit(selected, group, inner.key, e.target.checked))
                          }
                        />
                        Editar
                      </span>
                    </label>
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
      ) : null}

      <div className="permission-group">
        <div className="permission-table-head">
          <strong>Cadastros e sistema</strong>
          <span>Ver</span>
          <span>Editar</span>
        </div>
        {PAGE_PERMISSIONS.map((page) => (
          <AccessRow key={page.key} label={page.label} viewKey={page.key} selected={selected} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}

export function UsersAdmin() {
  const { sheets, siteGroups, authUser, refreshAuthUser } = useApp();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [createNome, setCreateNome] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPermissions, setCreatePermissions] = useState<string[]>([]);

  const [editId, setEditId] = useState<number | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editAtivo, setEditAtivo] = useState(true);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);

  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const editing = useMemo(() => users.find((user) => user.id === editId) ?? null, [users, editId]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setUsers(await api.adminUsers());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível carregar os usuários.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  function openEdit(user: AdminUserRow) {
    setEditId(user.id);
    setEditNome(user.nome);
    setEditEmail(user.email);
    setEditPassword("");
    setEditAtivo(user.ativo);
    setEditPermissions([...user.permissions]);
    setVerifyEmail(user.email);
    setVerifyResult(null);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await api.createAdminUser({
        nome: createNome,
        email: createEmail,
        password: createPassword,
        ativo: true,
        permissions: createPermissions,
      });
      setCreateNome("");
      setCreateEmail("");
      setCreatePassword("");
      setCreatePermissions([]);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível criar o usuário.");
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editId) return;
    setSaving(true);
    setErr(null);
    try {
      await api.updateAdminUser(editId, {
        nome: editNome,
        email: editEmail,
        password: editPassword.trim() || undefined,
        ativo: editAtivo,
        permissions: editPermissions,
      });
      await load();
      setEditPassword("");
      if (editId === authUser?.id) await refreshAuthUser();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível salvar o usuário.");
    } finally {
      setSaving(false);
    }
  }

  async function submitVerifyPassword(event: FormEvent) {
    event.preventDefault();
    setVerifying(true);
    setVerifyResult(null);
    setErr(null);
    try {
      const result = await api.verifyAdminPassword(verifyEmail, verifyPassword);
      setVerifyResult(result.ok ? "Senha correta." : result.reason ?? "Senha incorreta.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha ao verificar senha.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="page users-admin">
      <h2 style={{ marginBottom: 8 }}>Usuários e permissões</h2>
      <p className="lead" style={{ marginTop: 0 }}>
        Cadastre usuários na API ORDS, verifique senhas e defina em quais abas e telas internas cada pessoa
        pode entrar. Em Indicadores, por exemplo, dá para liberar só Gestão de colheita-CTT e ocultar Combustível.
        Usuários sem permissões marcadas continuam com acesso total.
      </p>

      <ReadOnlyFieldset>

      {err ? (
        <p className="lead" style={{ color: "var(--danger)" }}>
          {err}
        </p>
      ) : null}

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>Novo usuário</h3>
        <form className="form-grid" onSubmit={(e) => void submitCreate(e)}>
          <label>
            Nome
            <input value={createNome} onChange={(e) => setCreateNome(e.target.value)} required />
          </label>
          <label>
            E-mail
            <input type="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} required />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              required
              minLength={6}
            />
          </label>
          <div style={{ gridColumn: "1 / -1" }}>
            <PermissionPicker
              selected={createPermissions}
              onChange={setCreatePermissions}
              sheets={sheets}
              siteGroups={siteGroups}
            />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn primary" disabled={saving}>
              Criar usuário
            </button>
          </div>
        </form>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <h3>Verificar senha</h3>
        <form className="form-grid" onSubmit={(e) => void submitVerifyPassword(e)}>
          <label>
            E-mail
            <input type="email" value={verifyEmail} onChange={(e) => setVerifyEmail(e.target.value)} required />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={verifyPassword}
              onChange={(e) => setVerifyPassword(e.target.value)}
              required
            />
          </label>
          <div className="modal-actions">
            <button type="submit" className="btn" disabled={verifying}>
              Verificar
            </button>
            {verifyResult ? <span className="lead">{verifyResult}</span> : null}
          </div>
        </form>
      </section>

      <section className="panel">
        <h3>Usuários cadastrados</h3>
        {loading ? <p>Carregando…</p> : null}
        {!loading && !users.length ? <p>Nenhum usuário encontrado na API.</p> : null}
        {users.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Status</th>
                  <th>Permissões</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.nome}</td>
                    <td>{user.email}</td>
                    <td>{user.ativo ? "Ativo" : "Inativo"}</td>
                    <td>
                      {!user.permissions.length
                        ? "Acesso total"
                        : user.permissions.includes(PERMISSION_ADMIN)
                          ? "Administrador"
                          : `${user.permissions.filter((key) => !key.endsWith(":edit")).length} aba(s)`}
                    </td>
                    <td>
                      <button type="button" className="btn" onClick={() => openEdit(user)}>
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      </ReadOnlyFieldset>

      {editing ? (
        <div className="modal-back" onClick={() => setEditId(null)}>
          <div className="modal users-admin-modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Editar usuário</h3>
            <form className="form-grid" onSubmit={(e) => void submitEdit(e)}>
              <label>
                Nome
                <input value={editNome} onChange={(e) => setEditNome(e.target.value)} required />
              </label>
              <label>
                E-mail
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
              </label>
              <label>
                Nova senha
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Deixe em branco para manter"
                  minLength={6}
                />
              </label>
              <label className="check-label">
                <span className="check-row">
                  <input type="checkbox" checked={editAtivo} onChange={(e) => setEditAtivo(e.target.checked)} />
                  Usuário ativo
                </span>
              </label>
              <div style={{ gridColumn: "1 / -1" }}>
                <PermissionPicker
                  selected={editPermissions}
                  onChange={setEditPermissions}
                  sheets={sheets}
                  siteGroups={siteGroups}
                />
              </div>
              {authUser?.id === editing.id ? (
                <p className="lead" style={{ gridColumn: "1 / -1", margin: 0 }}>
                  Alterar suas próprias permissões pode bloquear este cadastro. Use outro administrador se necessário.
                </p>
              ) : null}
              <div className="modal-actions" style={{ gridColumn: "1 / -1" }}>
                <button type="button" className="btn" onClick={() => setEditId(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn primary" disabled={saving}>
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
