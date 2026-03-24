import React, { useState } from 'react';

const api = window.s3api;

interface Props {
  bucket: string;
  currentPrefix: string;
  onClose: () => void;
  onRefresh: () => void;
}

export function SyncModal({ bucket, currentPrefix, onClose, onRefresh }: Props) {
  const [localDir, setLocalDir] = useState('');
  const [s3Prefix, setS3Prefix] = useState(currentPrefix);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickDir = async () => {
    const res = await (window as any).s3api.localReadDir('/');
    // Use a text input instead of a native dialog since local:readDir doesn't pick directories
    // The user can type the path directly
  };

  const runSync = async () => {
    if (!localDir.trim()) { setError('Local directory is required'); return; }
    setSyncing(true);
    setError(null);
    setResult(null);
    const res = await api.sync(localDir.trim(), bucket, s3Prefix);
    setSyncing(false);
    if (res.ok && res.result) {
      setResult(res.result);
      onRefresh();
    } else {
      setError(res.error || 'Sync failed');
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={{ fontWeight: 600 }}>Sync Local → S3</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.body}>
          <label style={s.label}>Local Directory</label>
          <input style={s.input} value={localDir} onChange={e => setLocalDir(e.target.value)}
            placeholder="/Users/you/my-folder" />

          <label style={s.label}>S3 Prefix (destination)</label>
          <input style={s.input} value={s3Prefix} onChange={e => setS3Prefix(e.target.value)}
            placeholder="folder/" />

          <div style={{ ...s.info, marginTop: 12 }}>
            <strong>Bucket:</strong> {bucket}<br />
            <strong>Algorithm:</strong> Upload if missing or size differs. MD5 check for files &lt;64 MB.
          </div>

          {error && <div style={s.errorMsg}>{error}</div>}

          {result && (
            <div style={s.resultBox}>
              <div style={{ color: 'var(--success)' }}>Uploaded: {result.uploaded}</div>
              <div style={{ color: 'var(--text2)' }}>Skipped: {result.skipped}</div>
              {result.failed > 0 && <div style={{ color: 'var(--danger)' }}>Failed: {result.failed}</div>}
              {result.errors.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--danger)' }}>
                  {result.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
                  {result.errors.length > 5 && <div>...and {result.errors.length - 5} more</div>}
                </div>
              )}
            </div>
          )}
        </div>
        <div style={s.footer}>
          <button style={s.btnPrimary} onClick={runSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Start Sync'}
          </button>
          <button style={s.btnCancel} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: 'var(--surface)', borderRadius: 10, display: 'flex', flexDirection: 'column', width: 480, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' },
  body: { padding: 20, display: 'flex', flexDirection: 'column', gap: 4 },
  footer: { display: 'flex', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14 },
  label: { fontSize: 11, color: 'var(--text2)', marginTop: 8 },
  input: { background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 6, padding: '7px 10px', color: 'var(--text)', fontSize: 13, outline: 'none' },
  info: { fontSize: 12, color: 'var(--text2)', background: 'var(--bg)', borderRadius: 6, padding: '10px 12px', lineHeight: 1.8 },
  errorMsg: { padding: '8px 12px', color: 'var(--danger)', background: 'rgba(248,81,73,0.1)', borderRadius: 6, fontSize: 12, marginTop: 8 },
  resultBox: { padding: '10px 12px', background: 'var(--bg)', borderRadius: 6, marginTop: 8, fontSize: 13, lineHeight: 1.8 },
  btnPrimary: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, cursor: 'pointer' },
  btnCancel: { background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 13, cursor: 'pointer' },
};
