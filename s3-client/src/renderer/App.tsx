import React, { useState, useCallback, useRef } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel';
import { S3Pane } from './components/S3Pane';
import { LocalPane } from './components/LocalPane';
import { TransferBar } from './components/TransferBar';
import { useS3 } from './hooks/useS3';
import { useTransfers } from './hooks/useTransfers';

const api = window.s3api;

export function App() {
  const s3 = useS3();
  const { transfers, addTransfer, updateTransfer, clearCompleted, activeCount } = useTransfers();
  const [transferConfig, setTransferConfig] = useState<TransferConfig>({
    multipartThresholdMB: 64, partSizeMB: 8, concurrency: 4, timeoutSeconds: 300,
  });
  const [leftWidth, setLeftWidth] = useState(400);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = ev.clientX - rect.left;
      setLeftWidth(Math.max(200, Math.min(newWidth, rect.width - 400)));
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleConnect = async (auth: AuthConfig, transfer: TransferConfig) => {
    setTransferConfig(transfer);
    return s3.connect({ auth, transfer });
  };

  const handleUpdateTransferConfig = (config: Partial<TransferConfig>) => {
    setTransferConfig(prev => {
      const next = { ...prev, ...config };
      api.updateTransferConfig(next);
      return next;
    });
  };

  const handleUploadFiles = async (paths: string[]) => {
    if (!s3.currentBucket) return;
    for (const p of paths) {
      const name = p.split('/').pop() || p;
      const id = addTransfer({ name, direction: 'upload', status: 'active', progress: 0, size: null });
      const res = await api.uploadFiles(s3.currentBucket, s3.prefix, [p]);
      updateTransfer(id, { status: res.ok ? 'done' : 'error', progress: 100, error: res.error });
    }
    s3.refresh();
  };

  // Login screen
  if (!s3.connected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, height: '100vh', background: 'var(--bg)' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'auto', maxHeight: '95vh' }}>
          <ConnectionPanel onConnect={handleConnect} loading={s3.loading} />
          {s3.error && (
            <div style={{ padding: '0 24px 20px', color: 'var(--danger)', fontSize: 13 }}>{s3.error}</div>
          )}
        </div>
      </div>
    );
  }

  // Main layout
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 256 256" style={{ flexShrink: 0 }}>
            <path d="M128 0C57.3 0 0 57.3 0 128s57.3 128 128 128 128-57.3 128-128S198.7 0 128 0z" fill="#232F3E"/>
            <path d="M88 108c0-8 2-14 6-18s10-6 18-6c7 0 13 2 17 6s6 10 6 18v8H88v-8zm63 8v-10c0-14-4-24-12-32s-18-12-32-12-24 4-32 12-12 18-12 32v10c0 14 4 24 12 32s18 12 32 12c8 0 16-2 22-5l-8-14c-4 2-9 3-14 3-8 0-14-2-18-6s-6-10-6-18v-4h68z" fill="#FF9900"/>
          </svg>
          <span style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 14 }}>Mac S3 Client</span>
        </div>
        {activeCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--accent)' }}>{activeCount} transfer{activeCount > 1 ? 's' : ''} active</span>
        )}
        <button style={disconnectBtn} onClick={s3.disconnect}>Disconnect</button>
      </div>

      {/* Dual-pane content */}
      <div ref={containerRef} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: leftWidth, flexShrink: 0, overflow: 'hidden', display: 'flex' }}>
          <LocalPane
            currentBucket={s3.currentBucket}
            s3Prefix={s3.prefix}
            onUploadFiles={handleUploadFiles}
            onError={s3.setError}
          />
        </div>

        {/* Draggable divider */}
        <div
          onMouseDown={onDividerMouseDown}
          style={{
            width: 4, flexShrink: 0, cursor: 'col-resize',
            background: 'var(--accent)', opacity: 0.6,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
        />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minWidth: 0 }}>
          <S3Pane
            connected={s3.connected}
            buckets={s3.buckets}
            bucketInfoMap={s3.bucketInfoMap}
            currentBucket={s3.currentBucket}
            prefix={s3.prefix}
            items={s3.items}
            loading={s3.loading}
            error={s3.error}
            onSelectBucket={s3.selectBucket}
            onOpenFolder={s3.openFolder}
            onNavigateToPrefix={s3.navigateToPrefix}
            onGoUp={s3.goUp}
            onRefresh={s3.refresh}
            onEmptyBucket={() => {}}
            onDeleteBucket={() => {}}
            onRemoveBucket={s3.removeBucket}
            onError={s3.setError}
            onClearError={() => s3.setError(null)}
            transferConfig={transferConfig}
            onUpdateTransferConfig={handleUpdateTransferConfig}
            onAddTransfer={addTransfer}
            onUpdateTransfer={updateTransfer}
          />
        </div>
      </div>

      {/* Transfer bar */}
      <TransferBar transfers={transfers} onClearCompleted={clearCompleted} />
    </div>
  );
}

const topBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '6px 16px', borderBottom: '1px solid var(--border)',
  background: 'var(--surface)', flexShrink: 0,
};

const disconnectBtn: React.CSSProperties = {
  background: 'var(--border)', color: 'var(--text)', border: 'none',
  borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
};
