/** Staff sign-in, with the second factor as a separate step for privileged roles. */
import { useId, useState } from 'react';
import { api, RequestFailed, type Session } from '../api.ts';

export function Login({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'CREDENTIALS' | 'MFA'>('CREDENTIALS');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = useId();
  const passId = useId();
  const codeId = useId();

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (stage === 'CREDENTIALS') {
        const out = await api.post<{ mfaPending: boolean }>('/api/auth/login', { username, password });
        if (out.mfaPending) { setStage('MFA'); return; }
      } else {
        await api.post('/api/auth/mfa', { code });
      }
      onSignedIn(await api.get<Session>('/api/auth/me'));
    } catch (err) {
      setError(err instanceof RequestFailed ? err.apiError.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="portal">
      <div className="app__banner">Demonstration data — not actual IKN performance.</div>
      <main className="portal__main">
        <form className="portal__card" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <h1>IKN Medical Report Tracking &amp; Performance System</h1>
          <p className="muted">
            Staff sign-in. In production this is IKN staff single sign-on with a second factor for
            privileged roles; the prototype uses local accounts so the permission model can be
            exercised end to end.
          </p>

          {stage === 'CREDENTIALS' ? (
            <>
              <div className="portal__field">
                <label htmlFor={userId}>Username</label>
                <input id={userId} value={username} autoComplete="username" required
                  onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="portal__field">
                <label htmlFor={passId}>Password</label>
                <input id={passId} type="password" value={password} autoComplete="current-password"
                  required onChange={(e) => setPassword(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="portal__field">
              <label htmlFor={codeId}>Second factor — 6-digit code</label>
              <input id={codeId} value={code} inputMode="numeric" pattern="\d{6}" maxLength={6}
                required onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <span className="hint">
                This role requires a second factor. The prototype accepts 000000 and records the
                factor as simulated in the audit trail; no permission is granted until it is cleared.
              </span>
            </div>
          )}

          {error && <p className="portal__error" role="alert">{error}</p>}
          <button className="portal__btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : stage === 'CREDENTIALS' ? 'Sign in' : 'Verify'}
          </button>
          <p className="muted">
            Prototype accounts, password <code>ikn-prototype-2026</code>: records1,
            records.super, finance1, finance2, director, sysadmin, hod.rto … hod.omf, and one
            login per doctor (demo-d001 … demo-d018).
          </p>
        </form>
      </main>
    </div>
  );
}
