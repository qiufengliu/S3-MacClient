import React, { useState, useEffect, useCallback } from 'react';
import { FileTable } from './FileTable';
import { ContextMenu, MenuItem } from './ContextMenu';
import { PreviewModal } from './PreviewModal';
import { VersionsModal } from './VersionsModal';
import { SyncModal } from './SyncModal';

const api = window.s3api;

const PREVIEW_IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','svg','webp','bmp','ico']);
const PREVIEW_VIDEO_EXTS = new Set(['mp4','mov','webm','m4v','mkv']);

function isPreviewable(name: string): boolean {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return PREVIEW_IMAGE_EXTS.has(ext) || PREVIEW_VIDEO_EXTS.has(ext);
}

interface Props {
  connected: boolean;
  buckets: string[];
  bucketInfoMap: Record<string, BucketInfo>;
  currentBucket: string | null;
  prefix: string;
  items: S3Item[];
  loading: boolean;
  error: string | null;
  onSelectBucket: (b: string) => void;
  onOpenFolder: (item: S3Item) => void;
  onNavigateToPrefix: (bucket: string, prefix: string) => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onEmptyBucket: (b: string) => void;
  onDeleteBucket: (b: string) => void;
  onRemoveBucket: (b: string) => void;
  onError: (msg: string) => void;
  onClearError: () => void;
  transferConfig: TransferConfig;
  onUpdateTransferConfig: (c: Partial<TransferConfig>) => void;
  onAddTransfer: (item: Omit<TransferItem, 'id'>) => string;
  onUpdateTransfer: (id: string, updates: Partial<TransferItem>) => void;
}

interface BucketAction { bucket: string; action: 'empty' | 'delete' }

export function S3Pane(props: Props) {
  const {
    connected, buckets, bucketInfoMap, currentBucket, prefix, items, loading, error,
    onSelectBucket, onOpenFolder, onNavigateToPrefix, onGoUp, onRefresh,
    onEmptyBucket, onDeleteBucket, onError, onClearError,
    transferConfig, onUpdateTransferConfig, onAddTransfer, onUpdateTransfer,
  } = props;

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: S3Item } | null>(null);
  const [bucketCtxMenu, setBucketCtxMenu] = useState<{ x: number; y: number; bucket: string } | null>(null);
  const [previewItem, setPreviewItem] = useState<S3Item | null>(null);
  const [previewSrc, setPreviewSrc] = useState<{ type: 'image' | 'video'; src: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [versionsItem, setVersionsItem] = useState<S3Item | null>(null);
  const [showSync, setShowSync] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [bucketAction, setBucketAction] = useState<BucketAction | null>(null);
  const [emptyProgress, setEmptyProgress] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ keys: string[] } | null>(null);
  const [presignItem, setPresignItem] = useState<S3Item | null>(null);
  const [presignUrl, setPresignUrl] = useState<string | null>(null);
  const [policyBucket, setPolicyBucket] = useState<string | null>(null);
  const [policyContent, setPolicyContent] = useState<string | null>(null);
  useEffect(() => {
    const cleanupEmpty = api.onEmptyProgress(data => setEmptyProgress(data.deleted));
    return () => { cleanupEmpty(); };
  }, []);

  const filtered = items.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = (key: string) => {
    setSelectedKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const toggleSelectAll = (visibleItems: S3Item[]) => {
    if (selectedKeys.size === visibleItems.length) setSelectedKeys(new Set());
    else setSelectedKeys(new Set(visibleItems.map(i => i.key)));
  };

  const handlePreview = async (item: S3Item) => {
    if (!currentBucket || !isPreviewable(item.name)) return;
    setPreviewItem(item);
    setPreviewSrc(null);
    setPreviewLoading(true);
    const res = await api.previewObject(currentBucket, item.key);
    setPreviewLoading(false);
    if (res.ok && res.type === 'image' && res.dataUrl) {
      setPreviewSrc({ type: 'image', src: res.dataUrl });
    } else if (res.ok && res.type === 'video' && res.filePath) {
      setPreviewSrc({ type: 'video', src: `file://${res.filePath}` });
    } else {
      setPreviewItem(null);
      onError(res.error || 'Preview failed');
    }
  };

  const handleDownload = async (item: S3Item) => {
    if (!currentBucket) return;
    const id = onAddTransfer({ name: item.name, direction: 'download', status: 'active', progress: 0, size: item.size });
    const res = await api.download(currentBucket, item.key, id);
    onUpdateTransfer(id, { status: res.ok ? 'done' : 'error', progress: res.ok ? 100 : undefined, error: res.error });
    if (!res.ok && res.error !== 'Cancelled') onError(res.error || 'Download failed');
  };

  const handleBatchDownload = async (overrideItems?: { key: string; isFolder: boolean }[]) => {
    if (!currentBucket) return;
    const dl = overrideItems || filtered.filter(i => selectedKeys.has(i.key)).map(i => ({ key: i.key, isFolder: i.isFolder }));
    if (dl.length === 0) return;
    const id = onAddTransfer({ name: `${dl.length} file${dl.length > 1 ? 's' : ''}`, direction: 'download', status: 'active', progress: 0, size: null });
    const res = await api.batchDownload(currentBucket, dl, prefix, id);
    onUpdateTransfer(id, { status: res.ok ? 'done' : 'error', progress: res.ok ? 100 : undefined, error: res.error });
    if (res.ok) {
      setSelectedKeys(new Set());
      if (res.failed && res.failed > 0) onError(`Downloaded ${res.succeeded}, ${res.failed} failed`);
    } else if (res.error !== 'Cancelled') {
      onError(res.error || 'Batch download failed');
    }
  };

  const handleDelete = (item: S3Item) => {
    setDeleteConfirm({ keys: [item.key] });
  };

  const handleBatchDelete = () => {
    const keys = filtered.filter(i => selectedKeys.has(i.key)).map(i => i.key);
    if (keys.length > 0) setDeleteConfirm({ keys });
  };

  const confirmDelete = async () => {
    if (!currentBucket || !deleteConfirm) return;
    const { keys } = deleteConfirm;
    setDeleteConfirm(null);
    let res;
    if (keys.length === 1) {
      res = await api.delete(currentBucket, keys[0]);
    } else {
      res = await api.batchDelete(currentBucket, keys);
    }
    if (res.ok) { setSelectedKeys(new Set()); onRefresh(); }
    else onError(res.error || 'Delete failed');
  };

  const handleRename = async (item: S3Item, newName: string) => {
    if (!currentBucket || !newName.trim() || newName === item.name) { setRenamingKey(null); return; }
    const dir = item.key.slice(0, item.key.length - item.name.length);
    const newKey = dir + newName.trim();
    const res = await api.rename(currentBucket, item.key, newKey);
    setRenamingKey(null);
    if (res.ok) onRefresh();
    else onError(res.error || 'Rename failed');
  };

  const handlePresign = async (item: S3Item, expiresIn: number) => {
    if (!currentBucket) return;
    const res = await api.presign(currentBucket, item.key, expiresIn);
    if (res.ok && res.url) {
      navigator.clipboard.writeText(res.url);
      setPresignItem(null);
      setPresignUrl(res.url);
      setTimeout(() => setPresignUrl(null), 4000);
    } else {
      onError(res.error || 'Presign failed');
    }
  };

  const handleCreateFolder = async () => {
    if (!currentBucket || !newFolderName.trim()) return;
    const key = prefix + newFolderName.trim();
    const res = await api.createFolder(currentBucket, key);
    if (res.ok) { setShowNewFolder(false); setNewFolderName(''); onRefresh(); }
    else onError(res.error || 'Create folder failed');
  };

  const handleUpload = async () => {
    if (!currentBucket) return;
    const res = await api.upload(currentBucket, prefix);
    if (res.ok) onRefresh();
    else if (res.error !== 'Cancelled') onError(res.error || 'Upload failed');
  };

  const handleEmptyBucket = async (bucket: string) => {
    setEmptyProgress(0);
    setBucketAction({ bucket, action: 'empty' });
    const res = await api.emptyBucket(bucket);
    setBucketAction(null);
    setEmptyProgress(null);
    if (res.ok) { if (currentBucket === bucket) onRefresh(); }
    else onError(res.error || 'Empty bucket failed');
  };

  const handleDeleteBucket = async (bucket: string) => {
    setEmptyProgress(0);
    setBucketAction({ bucket, action: 'delete' });
    const emptyRes = await api.emptyBucket(bucket);
    if (!emptyRes.ok) { setBucketAction(null); setEmptyProgress(null); onError(emptyRes.error || 'Empty failed'); return; }
    const delRes = await api.deleteBucket(bucket);
    setBucketAction(null);
    setEmptyProgress(null);
    if (delRes.ok) props.onRemoveBucket(bucket);
    else onError(delRes.error || 'Delete bucket failed');
  };

  const handleViewPolicy = async (bucket: string) => {
    const res = await api.getBucketPolicy(bucket);
    if (res.ok) {
      try {
        setPolicyContent(JSON.stringify(JSON.parse(res.policy || '{}'), null, 2));
      } catch {
        setPolicyContent(res.policy || '{}');
      }
      setPolicyBucket(bucket);
    } else {
      onError(res.error || 'Failed to load policy');
    }
  };

  const getS3ContextItems = (item: S3Item): MenuItem[] => {
    const items: MenuItem[] = [];
    if (!item.isFolder) {
      items.push({ label: 'Download', icon: '⬇️', onClick: () => handleDownload(item) });
      if (isPreviewable(item.name)) {
        items.push({ label: 'Preview', icon: '👁️', onClick: () => handlePreview(item) });
      }
      items.push({ label: 'Copy Presigned URL', icon: '🔗', onClick: () => setPresignItem(item) });
      items.push({ label: 'Version History', icon: '🕐', onClick: () => setVersionsItem(item) });
      items.push({ label: '---', onClick: () => {} });
      items.push({ label: 'Rename', icon: '✏️', onClick: () => { setRenamingKey(item.key); } });
    } else {
      items.push({ label: 'Download Folder', icon: '⬇️', onClick: () => handleBatchDownload([{ key: item.key, isFolder: true }]) });
    }
    items.push({ label: '---', onClick: () => {} });
    items.push({ label: 'Delete', icon: '🗑️', danger: true, onClick: () => handleDelete(item) });
    return items;
  };

  const breadcrumbs = () => {
    if (!currentBucket) return [];
    const crumbs: { label: string; prefix: string }[] = [{ label: currentBucket, prefix: '' }];
    if (prefix) {
      const parts = prefix.replace(/\/$/, '').split('/').filter(Boolean);
      let acc = '';
      for (const p of parts) {
        acc += p + '/';
        crumbs.push({ label: p, prefix: acc });
      }
    }
    return crumbs;
  };

  return (
    <div style={s.pane}>
      {/* Sidebar */}
      <div style={s.sidebar}>
        <div style={s.sidebarHeader}>
          <span style={s.paneTitle}>S3</span>
        </div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text2)', padding: '8px 12px 2px' }}>Buckets</div>
        <div style={s.bucketList}>
          {buckets.map(b => {
            const info = bucketInfoMap[b];
            const isActing = bucketAction?.bucket === b;
            return (
              <div key={b}
                style={{ ...s.bucketItem, background: b === currentBucket ? 'var(--accent)' : 'transparent', color: b === currentBucket ? '#fff' : 'var(--text)' }}
                onClick={() => onSelectBucket(b)}
                onContextMenu={e => { e.preventDefault(); setBucketCtxMenu({ x: e.clientX, y: e.clientY, bucket: b }); }}>
                <span>🪣</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b}</span>
                {isActing && (
                  <span style={{ fontSize: 10, color: b === currentBucket ? 'rgba(255,255,255,0.7)' : 'var(--text2)' }}>
                    {emptyProgress !== null ? emptyProgress : '...'}
                  </span>
                )}
                {!isActing && info && (
                  <span style={{ fontSize: 10, color: b === currentBucket ? 'rgba(255,255,255,0.7)' : 'var(--text2)', flexShrink: 0 }}>{info.region}</span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
            onClick={() => setShowTransfer(!showTransfer)}>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>Transfer Settings</span>
            <span style={{ fontSize: 9, color: 'var(--text2)' }}>{showTransfer ? '▲' : '▼'}</span>
          </div>
          {showTransfer && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, fontSize: 12 }}>
              {([
                ['Multipart MB', 'multipartThresholdMB', 5, 5000],
                ['Part Size MB', 'partSizeMB', 5, 5120],
                ['Concurrency', 'concurrency', 1, 20],
                ['Timeout s', 'timeoutSeconds', 30, 3600],
              ] as [string, keyof TransferConfig, number, number][]).map(([lbl, key, min, max]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text2)', fontSize: 11 }}>{lbl}</span>
                  <input style={s.smallInput} type="number" min={min} max={max} value={transferConfig[key]}
                    onChange={e => onUpdateTransferConfig({ [key]: +e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div style={s.main}>
        {currentBucket ? (
          <>
            {/* Toolbar */}
            <div style={s.toolbar}>
              <button style={s.iconBtn} onClick={onGoUp} disabled={!prefix} title="Go up">⬆️</button>
              <button style={s.iconBtn} onClick={onRefresh} title="Refresh">🔄</button>
              <button style={s.iconBtn} onClick={handleUpload} title="Upload files">📤</button>
              <button style={s.iconBtn} onClick={() => setShowNewFolder(!showNewFolder)} title="New folder">📁</button>
              <button style={s.iconBtn} onClick={() => setShowSync(true)} title="Sync local folder">🔄➡</button>
              {selectedKeys.size > 0 && (
                <>
                  <button style={s.btnAction} onClick={() => handleBatchDownload()}>⬇️ Download ({selectedKeys.size})</button>
                  <button style={{ ...s.btnAction, background: 'rgba(248,81,73,0.15)', color: 'var(--danger)' }} onClick={handleBatchDelete}>
                    🗑️ Delete ({selectedKeys.size})
                  </button>
                </>
              )}
              <div style={s.breadcrumbs}>
                {breadcrumbs().map((c, i) => (
                  <span key={i}>
                    {i > 0 && <span style={{ color: 'var(--text2)', margin: '0 3px' }}>/</span>}
                    <span style={s.crumb} onClick={() => onNavigateToPrefix(currentBucket!, c.prefix)}>{c.label}</span>
                  </span>
                ))}
              </div>
              <input style={{ ...s.searchInput, marginLeft: 'auto' }} placeholder="Filter..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {showNewFolder && (
              <div style={s.newFolderBar}>
                <input style={s.searchInput} placeholder="Folder name" value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} />
                <button style={s.btnAction} onClick={handleCreateFolder}>Create</button>
                <button style={s.btnCancel} onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}>Cancel</button>
              </div>
            )}

            {error && (
              <div style={s.errorBar}>
                {error}
                <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', marginLeft: 8 }} onClick={onClearError}>✕</button>
              </div>
            )}

            {deleteConfirm && (
              <div style={s.confirmBar}>
                Delete {deleteConfirm.keys.length} item{deleteConfirm.keys.length > 1 ? 's' : ''}? This cannot be undone.
                <button style={{ ...s.btnAction, marginLeft: 12, background: 'var(--danger)' }} onClick={confirmDelete}>Delete</button>
                <button style={s.btnCancel} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              </div>
            )}

            {presignUrl && (
              <div style={{ ...s.confirmBar, background: 'rgba(63,185,80,0.1)', color: 'var(--success)', borderColor: 'var(--success)' }}>
                URL copied to clipboard!
              </div>
            )}

            <FileTable
              items={filtered}
              selectedKeys={selectedKeys}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onDoubleClick={item => item.isFolder && onOpenFolder(item)}
              onClick={item => { if (!item.isFolder && isPreviewable(item.name)) handlePreview(item); }}
              onContextMenu={(item, e) => setCtxMenu({ x: e.clientX, y: e.clientY, item })}
              renamingKey={renamingKey}
              onRenameSubmit={handleRename}
              onRenameCancel={() => setRenamingKey(null)}
              loading={loading}
            />
          </>
        ) : (
          <div style={s.empty}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🪣</div>
            <div style={{ color: 'var(--text2)' }}>Select a bucket</div>
          </div>
        )}
      </div>

      {/* Context menus */}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y}
          items={getS3ContextItems(ctxMenu.item)}
          onClose={() => setCtxMenu(null)} />
      )}
      {bucketCtxMenu && (
        <ContextMenu x={bucketCtxMenu.x} y={bucketCtxMenu.y}
          items={[
            { label: 'Empty Bucket', icon: '🧹', onClick: () => handleEmptyBucket(bucketCtxMenu.bucket) },
            { label: 'View Policy', icon: '📋', onClick: () => handleViewPolicy(bucketCtxMenu.bucket) },
            { label: '---', onClick: () => {} },
            { label: 'Delete Bucket', icon: '🗑️', danger: true, onClick: () => handleDeleteBucket(bucketCtxMenu.bucket) },
          ]}
          onClose={() => setBucketCtxMenu(null)} />
      )}

      {/* Modals */}
      {previewItem && (
        <PreviewModal item={previewItem} src={previewSrc} loading={previewLoading}
          onClose={() => { setPreviewItem(null); setPreviewSrc(null); }} />
      )}

      {versionsItem && currentBucket && (
        <VersionsModal bucket={currentBucket} item={versionsItem}
          onClose={() => setVersionsItem(null)} onRefresh={onRefresh} />
      )}

      {showSync && currentBucket && (
        <SyncModal bucket={currentBucket} currentPrefix={prefix}
          onClose={() => setShowSync(false)} onRefresh={onRefresh} />
      )}

      {/* Presign expiry picker */}
      {presignItem && (
        <div style={s.presignOverlay} onClick={() => setPresignItem(null)}>
          <div style={s.presignBox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>Copy Presigned URL</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>{presignItem.name}</div>
            {[
              ['15 minutes', 900],
              ['1 hour', 3600],
              ['24 hours', 86400],
              ['7 days', 604800],
            ].map(([label, secs]) => (
              <button key={secs} style={s.presignBtn} onClick={() => handlePresign(presignItem, secs as number)}>
                {label}
              </button>
            ))}
            <button style={{ ...s.presignBtn, marginTop: 8, color: 'var(--text2)' }} onClick={() => setPresignItem(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Bucket policy viewer */}
      {policyBucket && policyContent !== null && (
        <div style={s.presignOverlay} onClick={() => { setPolicyBucket(null); setPolicyContent(null); }}>
          <div style={{ ...s.presignBox, width: 600, maxHeight: '70vh' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>Bucket Policy: {policyBucket}</div>
            <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: '50vh', color: 'var(--text)' }}>
              {policyContent}
            </pre>
            <button style={{ ...s.presignBtn, marginTop: 12 }} onClick={() => { setPolicyBucket(null); setPolicyContent(null); }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  pane: { display: 'flex', flex: 1, overflow: 'hidden', minWidth: 0 },
  sidebar: { width: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 },
  sidebarHeader: { padding: '10px 12px', borderBottom: '1px solid var(--border)' },
  paneTitle: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--accent)' },
  bucketList: { flex: 1, overflowY: 'auto', padding: '4px 6px' },
  bucketItem: { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginBottom: 2, transition: 'background 0.1s' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  toolbar: { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flexShrink: 0 },
  iconBtn: { background: 'none', border: 'none', fontSize: 15, cursor: 'pointer', padding: '3px 6px', borderRadius: 4 },
  btnAction: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  btnCancel: { background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  breadcrumbs: { display: 'flex', alignItems: 'center', fontSize: 12, marginLeft: 4, overflow: 'hidden' },
  crumb: { cursor: 'pointer', color: 'var(--accent)', padding: '1px 3px', borderRadius: 3, whiteSpace: 'nowrap' },
  searchInput: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px', color: 'var(--text)', fontSize: 12, outline: 'none', width: 160 },
  smallInput: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 6px', color: 'var(--text)', fontSize: 11, outline: 'none', width: 64 },
  newFolderBar: { display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexShrink: 0 },
  errorBar: { background: 'rgba(248,81,73,0.1)', color: 'var(--danger)', padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 12, display: 'flex', alignItems: 'center', flexShrink: 0 },
  confirmBar: { background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', color: 'var(--danger)', padding: '8px 12px', margin: '6px 10px', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', flexShrink: 0 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text2)' },
  presignOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  presignBox: { background: 'var(--surface)', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', minWidth: 280, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' },
  presignBtn: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', color: 'var(--text)', fontSize: 13, cursor: 'pointer', marginBottom: 4 },
};
