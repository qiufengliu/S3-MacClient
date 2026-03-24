import React, { useEffect, useState } from 'react';
import { ContextMenu, MenuItem } from './ContextMenu';
import { useLocalFS } from '../hooks/useLocalFS';

const api = window.s3api;

interface Props {
  currentBucket: string | null;
  s3Prefix: string;
  onUploadFiles: (paths: string[]) => void;
  onError: (msg: string) => void;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function fileIcon(item: LocalItem): string {
  if (item.isDir) return '📁';
  const ext = item.name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    pdf: '📄', zip: '📦', tar: '📦', gz: '📦',
    mp4: '🎬', mov: '🎬', mp3: '🎵', wav: '🎵',
    json: '⚙️', yaml: '⚙️', yml: '⚙️',
    js: '💻', ts: '💻', py: '💻', go: '💻', rs: '💻',
  };
  return map[ext] || '📄';
}

export function LocalPane({ currentBucket, s3Prefix, onUploadFiles, onError }: Props) {
  const { currentDir, items, loading, error, navigateTo, goUp, refresh } = useLocalFS();
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: LocalItem } | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [editingPath, setEditingPath] = useState(false);

  useEffect(() => { navigateTo(currentDir); }, []);
  useEffect(() => { if (error) onError(error); }, [error]);

  const toggleSelect = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedPaths.size === items.length) setSelectedPaths(new Set());
    else setSelectedPaths(new Set(items.map(i => i.path)));
  };

  const openInFinder = (item: LocalItem) => {
    // Use shell.showItemInFolder equivalent via IPC if needed
    // For now, navigate into directory
    if (item.isDir) navigateTo(item.path);
  };

  const uploadSelected = () => {
    const paths = items.filter(i => !i.isDir && selectedPaths.has(i.path)).map(i => i.path);
    if (paths.length > 0) onUploadFiles(paths);
  };

  const uploadItem = (item: LocalItem) => {
    if (!item.isDir) onUploadFiles([item.path]);
  };

  const handleContextMenu = (item: LocalItem, e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, item });
  };

  const ctxItems = ctxMenu ? ((): MenuItem[] => {
    const item = ctxMenu.item;
    const items: MenuItem[] = [];
    if (!item.isDir && currentBucket) {
      items.push({ label: 'Upload to S3', icon: '📤', onClick: () => uploadItem(item) });
      items.push({ label: '---', onClick: () => {} });
    }
    if (item.isDir) {
      items.push({ label: 'Open', icon: '📂', onClick: () => navigateTo(item.path) });
    }
    return items;
  })() : [];

  return (
    <div style={s.pane}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.paneTitle}>Local</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, marginLeft: 8 }}>
          <button style={s.iconBtn} onClick={goUp} title="Go up">⬆️</button>
          <button style={s.iconBtn} onClick={refresh} title="Refresh">🔄</button>
          {editingPath ? (
            <input
              autoFocus
              style={{ ...s.pathInput, flex: 1 }}
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onBlur={() => setEditingPath(false)}
              onKeyDown={e => {
                if (e.key === 'Enter') { navigateTo(pathInput); setEditingPath(false); }
                if (e.key === 'Escape') setEditingPath(false);
              }}
            />
          ) : (
            <div style={s.pathDisplay} onClick={() => { setPathInput(currentDir); setEditingPath(true); }}>
              {currentDir}
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {selectedPaths.size > 0 && currentBucket && (
        <div style={s.toolbar}>
          <button style={s.btnAction} onClick={uploadSelected}>
            📤 Upload ({items.filter(i => !i.isDir && selectedPaths.has(i.path)).length}) to S3
          </button>
        </div>
      )}

      {/* File list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={s.center}>Loading...</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: 32 }}>
                  <input type="checkbox" checked={items.length > 0 && selectedPaths.size === items.length}
                    onChange={toggleAll} style={{ cursor: 'pointer' }} />
                </th>
                <th style={s.th}>Name</th>
                <th style={{ ...s.th, width: 80 }}>Size</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.path}
                  style={{ ...s.tr, background: selectedPaths.has(item.path) ? 'var(--accent-bg)' : 'transparent' }}
                  onDoubleClick={() => item.isDir && navigateTo(item.path)}
                  onContextMenu={e => handleContextMenu(item, e)}>
                  <td style={{ ...s.td, width: 32 }} onClick={e => { e.stopPropagation(); toggleSelect(item.path); }}>
                    <input type="checkbox" checked={selectedPaths.has(item.path)}
                      onChange={() => toggleSelect(item.path)} style={{ cursor: 'pointer' }} />
                  </td>
                  <td style={s.td}>
                    <span style={{ cursor: item.isDir ? 'pointer' : 'default' }}
                      onClick={() => item.isDir && navigateTo(item.path)}>
                      {fileIcon(item)} {item.name}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: 'var(--text2)' }}>{item.isDir ? '—' : formatSize(item.size)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={3} style={{ ...s.td, textAlign: 'center', color: 'var(--text2)', padding: 24 }}>Empty</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  pane: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: 0 },
  header: { display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border)', gap: 4 },
  paneTitle: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--accent)', flexShrink: 0 },
  iconBtn: { background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', padding: '3px 5px', borderRadius: 4 },
  pathDisplay: { flex: 1, fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', padding: '3px 6px', borderRadius: 4, border: '1px solid transparent' },
  pathInput: { background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 6px', color: 'var(--text)', fontSize: 12, outline: 'none' },
  toolbar: { padding: '4px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, background: 'var(--surface)' },
  btnAction: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text2)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--bg)' },
  td: { padding: '5px 10px', borderBottom: '1px solid var(--border)' },
  tr: { transition: 'background 0.08s' },
};
