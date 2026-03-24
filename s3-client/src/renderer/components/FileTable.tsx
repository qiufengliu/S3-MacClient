import React, { useState } from 'react';

export type SortKey = 'name' | 'size' | 'lastModified' | 'storageClass';
export type SortDir = 'asc' | 'desc' | 'none';

interface Props {
  items: S3Item[];
  selectedKeys: Set<string>;
  onToggleSelect: (key: string) => void;
  onToggleSelectAll: (items: S3Item[]) => void;
  onDoubleClick: (item: S3Item) => void;
  onClick: (item: S3Item) => void;
  onContextMenu: (item: S3Item, e: React.MouseEvent) => void;
  renamingKey?: string | null;
  onRenameSubmit?: (item: S3Item, newName: string) => void;
  onRenameCancel?: () => void;
  loading?: boolean;
}

const STORAGE_CLASS_LABELS: Record<string, string> = {
  STANDARD: 'Standard',
  STANDARD_IA: 'IA',
  ONEZONE_IA: '1Z-IA',
  GLACIER: 'Glacier',
  GLACIER_IR: 'Glacier IR',
  DEEP_ARCHIVE: 'Deep Archive',
  INTELLIGENT_TIERING: 'Int. Tiering',
  REDUCED_REDUNDANCY: 'RRS',
};

function fileIcon(item: S3Item): string {
  if (item.isFolder) return '📁';
  const ext = item.name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    pdf: '📄', zip: '📦', tar: '📦', gz: '📦', rar: '📦',
    mp4: '🎬', mov: '🎬', mkv: '🎬', webm: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵',
    json: '⚙️', yaml: '⚙️', yml: '⚙️', xml: '⚙️', toml: '⚙️',
    js: '💻', ts: '💻', py: '💻', go: '💻', rs: '💻', java: '💻', swift: '💻', sh: '💻',
  };
  return map[ext] || '📄';
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function sortItems(items: S3Item[], key: SortKey, dir: SortDir): S3Item[] {
  if (dir === 'none') return items;
  const folders = items.filter(i => i.isFolder);
  const files = items.filter(i => !i.isFolder);
  const cmp = (a: S3Item, b: S3Item) => {
    let av: any, bv: any;
    if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (key === 'size') { av = a.size ?? -1; bv = b.size ?? -1; }
    else if (key === 'lastModified') { av = a.lastModified ?? ''; bv = b.lastModified ?? ''; }
    else { av = a.storageClass ?? ''; bv = b.storageClass ?? ''; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  };
  return [...folders.sort(cmp), ...files.sort(cmp)];
}

export function FileTable({
  items, selectedKeys, onToggleSelect, onToggleSelectAll,
  onDoubleClick, onClick, onContextMenu,
  renamingKey, onRenameSubmit, onRenameCancel, loading,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [renameValue, setRenameValue] = useState('');

  const cycleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); }
    else if (sortDir === 'asc') setSortDir('desc');
    else if (sortDir === 'desc') { setSortKey('name'); setSortDir('none'); }
    else setSortDir('asc');
  };

  const sorted = sortItems(items, sortKey, sortDir);

  const SortIndicator = ({ k }: { k: SortKey }) => {
    if (sortKey !== k || sortDir === 'none') return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
    return <span style={{ marginLeft: 4, color: 'var(--accent)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text2)' }}>Loading...</div>;
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={{ ...s.th, width: 36 }}>
              <input type="checkbox"
                checked={sorted.length > 0 && selectedKeys.size === sorted.length}
                onChange={() => onToggleSelectAll(sorted)}
                style={{ cursor: 'pointer' }} />
            </th>
            <th style={{ ...s.th, cursor: 'pointer' }} onClick={() => cycleSort('name')}>
              Name <SortIndicator k="name" />
            </th>
            <th style={{ ...s.th, width: 90, cursor: 'pointer' }} onClick={() => cycleSort('size')}>
              Size <SortIndicator k="size" />
            </th>
            <th style={{ ...s.th, width: 80, cursor: 'pointer' }} onClick={() => cycleSort('storageClass')}>
              Type <SortIndicator k="storageClass" />
            </th>
            <th style={{ ...s.th, width: 160, cursor: 'pointer' }} onClick={() => cycleSort('lastModified')}>
              Modified <SortIndicator k="lastModified" />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(item => (
            <tr key={item.key}
              style={{ ...s.tr, background: selectedKeys.has(item.key) ? 'var(--accent-bg)' : 'transparent' }}
              onDoubleClick={() => onDoubleClick(item)}
              onClick={() => onClick(item)}
              onContextMenu={e => { e.preventDefault(); onContextMenu(item, e); }}>
              <td style={{ ...s.td, width: 36 }} onClick={e => { e.stopPropagation(); onToggleSelect(item.key); }}>
                <input type="checkbox" checked={selectedKeys.has(item.key)}
                  onChange={() => onToggleSelect(item.key)} style={{ cursor: 'pointer' }} />
              </td>
              <td style={s.td}>
                {renamingKey === item.key ? (
                  <input
                    autoFocus
                    style={{ background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text)', fontSize: 13, width: '100%' }}
                    defaultValue={item.name}
                    onFocus={e => { setRenameValue(item.name); }}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') onRenameSubmit?.(item, renameValue);
                      if (e.key === 'Escape') onRenameCancel?.();
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <span style={{ userSelect: 'none' }}>
                    {fileIcon(item)} {item.name}
                  </span>
                )}
              </td>
              <td style={{ ...s.td, color: 'var(--text2)' }}>{formatSize(item.size)}</td>
              <td style={{ ...s.td, color: 'var(--text2)', fontSize: 11 }}>
                {item.storageClass ? (STORAGE_CLASS_LABELS[item.storageClass] || item.storageClass) : '—'}
              </td>
              <td style={{ ...s.td, color: 'var(--text2)', fontSize: 11 }}>{formatDate(item.lastModified)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--text2)', padding: 32 }}>Empty</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, position: 'sticky', top: 0, background: 'var(--bg)', userSelect: 'none' },
  td: { padding: '6px 12px', borderBottom: '1px solid var(--border)' },
  tr: { transition: 'background 0.08s' },
};
