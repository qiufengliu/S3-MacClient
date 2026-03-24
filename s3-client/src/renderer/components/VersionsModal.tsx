import React, { useState, useEffect } from 'react';

const api = window.s3api;

interface Props {
  bucket: string;
  item: S3Item;
  onClose: () => void;
  onRefresh: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function VersionsModal({ bucket, item, onClose, onRefresh }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    api.listVersions(bucket, item.key).then(res => {
      setLoading(false);
      if (res.ok) setVersions(res.versions || []);
      else setError(res.error || 'Failed to load versions');
    });
  }, [bucket, item.key]);

  const restore = async (v: Version) => {
    setActing(v.versionId);
    const res = await api.restoreVersion(bucket, item.key, v.versionId);
    setActing(null);
    if (res.ok) { onRefresh(); onClose(); }
    else setError(res.error || 'Restore failed');
  };

  const deleteVersion = async (v: Version) => {
    setActing(v.versionId);
    const res = await api.deleteVersion(bucket, item.key, v.versionId);
    setActing(null);
    if (res.ok) setVersions(prev => prev.filter(vv => vv.versionId !== v.versionId));
    else setError(res.error || 'Delete failed');
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={{ fontWeight: 600 }}>Version History</span>
          <span style={{ color: 'var(--text2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginLeft: 12 }}>{item.name}</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={s.center}>Loading...</div>}
          {error && <div style={s.errorMsg}>{error}</div>}
          {!loading && !error && (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Version ID</th>
                  <th style={s.th}>Size</th>
                  <th style={s.th}>Modified</th>
                  <th style={s.th}>Latest</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr key={v.versionId}>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{v.versionId.slice(0, 16)}...</td>
                    <td style={s.td}>{formatSize(v.size)}</td>
                    <td style={s.td}>{new Date(v.lastModified).toLocaleString()}</td>
                    <td style={s.td}>{v.isLatest ? <span style={{ color: 'var(--success)' }}>✓</span> : '—'}</td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {!v.isLatest && (
                          <button style={s.actionBtn} onClick={() => restore(v)} disabled={acting === v.versionId}>
                            {acting === v.versionId ? '...' : 'Restore'}
                          </button>
                        )}
                        <button style={{ ...s.actionBtn, color: 'var(--danger)' }} onClick={() => deleteVersion(v)} disabled={acting === v.versionId}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {versions.length === 0 && (
                  <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--text2)', padding: 24 }}>No versions found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: 'var(--surface)', borderRadius: 10, display: 'flex', flexDirection: 'column', width: 700, maxHeight: '80vh', overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' },
  header: { display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 8 },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14, padding: '2px 6px' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, color: 'var(--text2)' },
  errorMsg: { padding: 16, color: 'var(--danger)', background: 'rgba(248,81,73,0.1)', margin: 16, borderRadius: 6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--surface)' },
  td: { padding: '7px 12px', borderBottom: '1px solid var(--border)' },
  actionBtn: { background: 'var(--border)', border: 'none', color: 'var(--text)', borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer' },
};
