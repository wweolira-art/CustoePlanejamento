import { FormEvent, useState } from "react";
import { LoginCaneBackground } from "./LoginCaneBackground";

export function Login({
  onLogin,
  loading,
  error,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const busy = submitting || loading;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalErr(null);
    if (!email.trim() || !password) {
      setLocalErr("Informe e-mail e senha.");
      return;
    }
    setSubmitting(true);
    try {
      await onLogin(email.trim(), password);
    } catch (e) {
      setLocalErr(e instanceof Error ? e.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  const message = localErr || error;

  return (
    <div className="login-page">
      <LoginCaneBackground />
      <div className="login-cane-logo" role="img" aria-label="Elejota Agro" />
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap">
            <img
              src="/elejota-agro-logo.png"
              alt="Elejota Agro"
              className="login-logo"
            />
          </div>
          <small>Controle Agrícola</small>
          <h1>Entrar</h1>
          <p>Use o e-mail e a senha cadastrados.</p>
        </div>

        <form className="login-form" onSubmit={(e) => void submit(e)}>
          <label>
            E-mail
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@agrocontrol.app"
              disabled={busy}
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              disabled={busy}
            />
          </label>
          {message ? (
            <p className="login-error" role="alert">
              {message}
            </p>
          ) : null}
          <button type="submit" className="btn primary login-submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
