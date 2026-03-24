import React, { useState } from 'react';

interface Props {
  transfers: TransferItem[];
  onClearCompleted: () => void;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

const STATUS_ICON: Record<TransferItem['status'], string> = {
  pending: '⏳', active: '⬆️', done: '✓', error: '✗',
};

export function TransferBar({ transfers, onClearCompleted }: Props) {
  const [expanded, setExpanded] = useState(false);
  const active = transfers.filter(t => t.status === 'active' || t.status === 'pending');
  const hasItems = transfers.length > 0;

  if (!hasItems) return null;

  return (
    <div style={s.bar}>
      <div style={s.header} onClick={() => setExpanded(e => !e)}>
        <span style={{ fontWeight: 500, fontSize: 12 }}>
          {active.length > 0 ? `Transferring ${active.length} file${active.length > 1 ? 's' : ''}...` : `Transfers (${transfers.length})`}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {transfers.some(t => t.status === 'done' || t.status === 'error') && (
            <button style={s.clearBtn} onClick={e => { e.stopPropagation(); onClearCompleted(); }}>
              Clear
            </button>
          )}
          <span style={{ fontSize: 10, color: 'var(--text2)' }}>{expanded ? '▼' : '▲'}</span>
        </div>
      </div>
      {expanded && (
        <div style={s.list}>
          {transfers.map(t => (
            <div key={t.id} style={s.row}>
              <span style={{ ...s.icon, color: t.status === 'error' ? 'var(--danger)' : t.status === 'done' ? 'var(--success)' : 'var(--accent)' }}>
                {STATUS_ICON[t.status]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {t.name} {t.size ? `(${formatSize(t.size)})` : ''}
                </div>
                {t.status === 'active' && (
                  <div style={s.progressTrack}>
                    <div style={{ ...s.progressBar, width: `${t.progress}%` }} />
                  </div>
                )}
                {t.status === 'error' && t.error && (
                  <div style={{ fontSize: 11, color: 'var(--danger)' }}>{t.error}</div>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text2)', flexShrink: 0 }}>
                {t.direction === 'upload' ? '↑' : '↓'} {t.status === 'active' ? `${t.progress}%` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  bar: { background: 'var(--surface)', borderTop: '1px solid var(--border)', flexShrink: 0 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px', cursor: 'pointer' },
  list: { maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--border)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderBottom: '1px solid var(--border)' },
  icon: { fontSize: 12, flexShrink: 0 },
  progressTrack: { height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: 3 },
  progressBar: { height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.2s' },
  clearBtn: { background: 'none', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text2)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' },
};
