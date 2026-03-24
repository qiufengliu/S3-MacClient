import React, { useState, useEffect } from 'react';

const api = window.s3api;

const REGIONS = [
  'us-east-1','us-east-2','us-west-1','us-west-2',
  'eu-west-1','eu-west-2','eu-central-1',
  'ap-northeast-1','ap-northeast-2','ap-southeast-1','ap-southeast-2',
  'ap-south-1','ap-east-1','sa-east-1',
  'me-south-1','me-central-1','af-south-1',
  'cn-north-1','cn-northwest-1',
];

interface Props {
  onConnect: (auth: AuthConfig, transfer: TransferConfig) => Promise<{ ok: boolean; error?: string }>;
  loading: boolean;
}

export function ConnectionPanel({ onConnect, loading }: Props) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'profile' | 'keys'>('profile');
  const [profile, setProfile] = useState('default');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [region, setRegion] = useState('us-west-2');
  const [showTransfer, setShowTransfer] = useState(false);
  const [transfer, setTransfer] = useState<TransferConfig>({
    multipartThresholdMB: 64, partSizeMB: 8, concurrency: 4, timeoutSeconds: 300,
  });
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  useEffect(() => {
    api.connList().then(res => {
      if (res.ok) setConnections(res.connections || []);
    });
  }, []);

  const connectSaved = async (conn: SavedConnection) => {
    setConnectingId(conn.id);
    setError(null);
    const auth: AuthConfig = {
      mode: conn.mode,
      profile: conn.profile,
      accessKeyId: conn.accessKeyId,
      region: conn.region,
      // Pass encryptedSecret so main process can decrypt it
      ...(conn.mode === 'keys' ? { encryptedSecret: (conn as any).encryptedSecret } : {}),
    };
    const res = await onConnect(auth, transfer);
    setConnectingId(null);
    if (!res.ok) setError(res.error || 'Connection failed');
  };

  const saveAndConnect = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setError(null);
    const id = Date.now().toString();
    const conn: SavedConnection = {
      id, name: name.trim(), mode, region,
      ...(mode === 'profile' ? { profile } : { accessKeyId }),
    };
    await api.connSave(conn, mode === 'keys' ? secretAccessKey : undefined);
    const updated = await api.connList();
    if (updated.ok) setConnections(updated.connections || []);

    const auth: AuthConfig = {
      mode, region,
      ...(mode === 'profile' ? { profile } : { accessKeyId, secretAccessKey }),
    };
    setConnectingId(id);
    const res = await onConnect(auth, transfer);
    setConnectingId(null);
    if (!res.ok) setError(res.error || 'Connection failed');
  };

  const deleteConn = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.connDelete(id);
    setConnections(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div style={s.wrap}>
      {/* Hero logo */}
      <div style={s.hero}>
        <div style={s.logoMark}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#f0883e"/>
                <stop offset="100%" stopColor="#e05a1a"/>
              </linearGradient>
              <linearGradient id="g2" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.15"/>
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0.03"/>
              </linearGradient>
            </defs>
            {/* Base rounded square */}
            <rect width="64" height="64" rx="16" fill="url(#g1)"/>
            {/* Subtle inner highlight */}
            <rect width="64" height="64" rx="16" fill="url(#g2)"/>
            {/* S3 text */}
            <text x="10" y="42" fontFamily="-apple-system, SF Pro Display, Helvetica Neue, sans-serif"
              fontWeight="700" fontSize="26" fill="white" letterSpacing="-1">S3</text>
            {/* Decorative lines */}
            <line x1="10" y1="48" x2="54" y2="48" stroke="white" strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="10" y1="52" x2="36" y2="52" stroke="white" strokeOpacity="0.15" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div style={s.heroText}>
          <div style={s.heroTitle}>Mac S3 Client</div>
          <div style={s.heroSub}>S3-compatible storage browser</div>
        </div>
      </div>

      {/* Saved connections */}
      {connections.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Saved Connections</div>
          {connections.map(conn => (
            <div key={conn.id} style={s.connRow} onClick={() => connectSaved(conn)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conn.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                  {conn.mode === 'profile' ? `Profile: ${conn.profile}` : `AK: ${conn.accessKeyId?.slice(0, 8)}...`} · {conn.region}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {connectingId === conn.id
                  ? <span style={{ fontSize: 11, color: 'var(--text2)' }}>Connecting...</span>
                  : <button style={s.btnConnect} onClick={e => { e.stopPropagation(); connectSaved(conn); }}>Connect</button>
                }
                <button style={s.btnDel} onClick={e => deleteConn(conn.id, e)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New connection form */}
      {!showNew ? (
        <button style={s.btnNew} onClick={() => setShowNew(true)}>+ New Connection</button>
      ) : (
        <div style={s.newForm}>
          <div style={s.sectionTitle}>New Connection</div>

          <label style={s.label}>Name</label>
          <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="My AWS Account" />

          <div style={s.toggle}>
            {(['profile', 'keys'] as const).map(m => (
              <button key={m} style={{ ...s.toggleBtn, ...(mode === m ? s.toggleActive : {}) }}
                onClick={() => setMode(m)}>
                {m === 'profile' ? 'AWS Profile' : 'Access Keys'}
              </button>
            ))}
          </div>

          {mode === 'profile' ? (
            <>
              <label style={s.label}>Profile Name</label>
              <input style={s.input} value={profile} onChange={e => setProfile(e.target.value)} placeholder="default" />
            </>
          ) : (
            <>
              <label style={s.label}>Access Key ID</label>
              <input style={s.input} value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} placeholder="AKIA..." />
              <label style={s.label}>Secret Access Key</label>
              <input style={s.input} type="password" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} placeholder="••••••••" />
            </>
          )}

          <label style={s.label}>Region</label>
          <select style={s.input} value={region} onChange={e => setRegion(e.target.value)}>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>

          <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '4px 0' }}
              onClick={() => setShowTransfer(!showTransfer)}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>Transfer Settings</span>
              <span style={{ fontSize: 10, color: 'var(--text2)' }}>{showTransfer ? '▲' : '▼'}</span>
            </div>
            {showTransfer && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                {([
                  ['Multipart Threshold (MB)', 'multipartThresholdMB', 5, 5000],
                  ['Part Size (MB)', 'partSizeMB', 5, 5120],
                  ['Concurrency', 'concurrency', 1, 20],
                  ['Timeout (sec)', 'timeoutSeconds', 30, 3600],
                ] as [string, keyof TransferConfig, number, number][]).map(([lbl, key, min, max]) => (
                  <div key={key}>
                    <label style={s.label}>{lbl}</label>
                    <input style={s.input} type="number" min={min} max={max} value={transfer[key]}
                      onChange={e => setTransfer(c => ({ ...c, [key]: +e.target.value }))} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div style={s.error}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={s.btnPrimary} onClick={saveAndConnect} disabled={loading}>
              {loading ? 'Connecting...' : 'Save & Connect'}
            </button>
            <button style={s.btnCancel} onClick={() => { setShowNew(false); setError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {!showNew && error && <div style={s.error}>{error}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12, padding: 28, width: 420, maxHeight: '90vh', overflowY: 'auto' },
  hero: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, paddingBottom: 20, borderBottom: '1px solid var(--border)' },
  logoMark: { flexShrink: 0, filter: 'drop-shadow(0 4px 12px rgba(240,136,62,0.4))' },
  heroText: { display: 'flex', flexDirection: 'column', gap: 4 },
  heroTitle: { fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' },
  heroSub: { fontSize: 12, color: 'var(--text2)', letterSpacing: '0.2px' },
  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text2)', marginBottom: 4 },
  connRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' },
  btnConnect: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  btnDel: { background: 'none', color: 'var(--text2)', border: 'none', fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 4 },
  btnNew: { background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer', textAlign: 'left' as const },
  newForm: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, color: 'var(--text2)', marginTop: 6 },
  input: { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 10px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%' },
  toggle: { display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', marginTop: 4 },
  toggleBtn: { flex: 1, padding: '7px 0', fontSize: 12, border: 'none', cursor: 'pointer', background: 'var(--surface)', color: 'var(--text2)' },
  toggleActive: { background: 'var(--accent)', color: '#fff' },
  btnPrimary: { flex: 1, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: 13, cursor: 'pointer' },
  btnCancel: { background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 6, padding: '9px 16px', fontSize: 13, cursor: 'pointer' },
  error: { background: 'rgba(248,81,73,0.1)', color: 'var(--danger)', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 4 },
};
