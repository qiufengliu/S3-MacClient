import React, { useEffect } from 'react';

interface Props {
  item: S3Item;
  src: { type: 'image' | 'video'; src: string } | null;
  loading: boolean;
  onClose: () => void;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function PreviewModal({ item, src, loading, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {item.name}
          </span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.body}>
          {loading && <div style={{ color: 'var(--text2)' }}>Loading preview...</div>}
          {!loading && src?.type === 'image' && (
            <img src={src.src} alt={item.name}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }} />
          )}
          {!loading && src?.type === 'video' && (
            <video src={src.src} controls autoPlay
              style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 4, background: '#000' }} />
          )}
        </div>
        {item.size !== null && (
          <div style={s.footer}>
            {formatSize(item.size)} · {item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: 'var(--surface)', borderRadius: 10, display: 'flex', flexDirection: 'column', maxWidth: '90vw', maxHeight: '88vh', minWidth: 320, overflow: 'hidden', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' },
  header: { display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 500, gap: 12 },
  body: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto', minHeight: 200 },
  footer: { padding: '6px 16px', fontSize: 11, color: 'var(--text2)', borderTop: '1px solid var(--border)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 4 },
};
