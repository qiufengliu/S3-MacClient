# Transfer Progress Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show real-time progress in the TransferBar for large uploads (≥ 64 MB multipart) and all downloads, replacing the current 0% → 100% jump.

**Architecture:** Add `onProgress` callbacks to `s3service.ts`, thread them through IPC handlers in `main.ts` via a unified `s3:transferProgress` event, expose listeners in `preload.ts`, and wire up a `useEffect` in `App.tsx` to call `updateTransfer` on each tick.

**Tech Stack:** Electron IPC (`ipcMain.handle` / `webContents.send`), Node.js `stream.PassThrough`, AWS SDK v3 (`@aws-sdk/client-s3`), React hooks.

**Note:** No test framework is configured. Verification steps use `npm run build` (TypeScript compile) + manual smoke testing in the running Electron app.

---

## File Map

| File | Change |
|------|--------|
| `src/main/s3service.ts` | Add `onProgress` param to `downloadFile`, `multipartUpload`, `uploadFile` |
| `src/main/main.ts` | Update 4 IPC handlers to accept `transferId`, send progress events, generate ids for `s3:upload` |
| `src/main/preload.ts` | Remove `onDownloadProgress`; add `onTransferProgress`, `onTransferStarted`; update 3 IPC call signatures |
| `src/renderer/hooks/useTransfers.ts` | Add `addTransferWithId` |
| `src/renderer/App.tsx` | Add `useEffect` to subscribe progress listeners; update `handleUploadFiles` |
| `src/renderer/components/S3Pane.tsx` | Pass `transferId` to `api.download`; migrate batch download to unified channel |

---

## Task 1: Add progress callbacks to s3service.ts

**Files:**
- Modify: `src/main/s3service.ts`

- [ ] **Step 1: Add `PassThrough` to the stream import in `s3service.ts`**

At the top of `s3service.ts`, update the stream import (currently `import { Readable } from 'stream';`) to:

```ts
import { Readable, PassThrough } from 'stream';
```

- [ ] **Step 2: Add `onProgress` to `downloadFile`**

In `s3service.ts`, replace the `downloadFile` method (currently lines 153–162) with the version below. It routes the response stream through a `PassThrough` to count bytes safely — attaching a `data` listener directly to the source stream before piping can put it into flowing mode prematurely:

```ts
async downloadFile(
  bucket: string,
  key: string,
  destPath: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stream = res.Body as Readable;
  const total = res.ContentLength ?? 0;
  let loaded = 0;
  const ws = fs.createWriteStream(destPath);
  await new Promise<void>((resolve, reject) => {
    const pt = new PassThrough();
    pt.on('data', (chunk: Buffer) => {
      loaded += chunk.length;
      if (total > 0 && onProgress) {
        onProgress(Math.round(loaded / total * 100));
      }
    });
    stream.pipe(pt).pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    stream.on('error', reject);
  });
}
```

- [ ] **Step 3: Add `onProgress` to `multipartUpload`**

Replace the private `multipartUpload` method signature and inner loop. Add `onProgress?: (pct: number) => void` as a fifth parameter. Add `let completedParts = 0;` before the loop. Inside the `.then()` for each part:

```ts
private async multipartUpload(
  bucket: string,
  key: string,
  filePath: string,
  fileSize: number,
  onProgress?: (pct: number) => void
): Promise<void> {
  const partSize = this.transferConfig.partSizeMB * 1024 * 1024;
  const concurrency = this.transferConfig.concurrency;

  const { UploadId } = await this.client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key })
  );
  if (!UploadId) throw new Error('Failed to create multipart upload');

  const totalParts = Math.ceil(fileSize / partSize);
  const parts: { ETag: string; PartNumber: number }[] = [];
  let completedParts = 0;
  const fd = fs.openSync(filePath, 'r');

  try {
    for (let i = 0; i < totalParts; i += concurrency) {
      const batch = [];
      for (let j = i; j < Math.min(i + concurrency, totalParts); j++) {
        const start = j * partSize;
        const end = Math.min(start + partSize, fileSize);
        const length = end - start;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, start);

        batch.push(
          this.client.send(new UploadPartCommand({
            Bucket: bucket, Key: key, UploadId,
            PartNumber: j + 1, Body: buffer,
          })).then(res => {
            parts.push({ ETag: res.ETag!, PartNumber: j + 1 });
            completedParts++;
            if (onProgress) onProgress(Math.round(completedParts / totalParts * 100));
          })
        );
      }
      await Promise.all(batch);
    }

    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: bucket, Key: key, UploadId,
      MultipartUpload: { Parts: parts },
    }));
  } catch (err) {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })).catch(() => {});
    throw err;
  } finally {
    fs.closeSync(fd);
  }
}
```

- [ ] **Step 4: Thread `onProgress` through `uploadFile`**

Update `uploadFile` signature and the multipart call:

```ts
async uploadFile(
  bucket: string,
  key: string,
  filePath: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const stat = fs.statSync(filePath);
  const thresholdBytes = this.transferConfig.multipartThresholdMB * 1024 * 1024;

  if (stat.size <= thresholdBytes) {
    const body = fs.readFileSync(filePath);
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
  } else {
    await this.multipartUpload(bucket, key, filePath, stat.size, onProgress);
  }
}
```

- [ ] **Step 5: Verify build passes**

```bash
cd /Users/guanliu/Desktop/kiro/S3-MacClient/s3-client
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/s3service.ts
git commit -m "feat: add onProgress callbacks to downloadFile, uploadFile, multipartUpload"
```

---

## Task 2: Update main.ts IPC handlers

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add a transfer ID generator at the top of main.ts**

After the existing imports and before any `ipcMain.handle` calls, add:

```ts
let _transferId = 0;
const nextTransferId = () => `main-t${++_transferId}`;
```

- [ ] **Step 2: Update `s3:download` handler**

Replace the `s3:download` handler with:

```ts
ipcMain.handle('s3:download', async (_e, bucket: string, key: string, transferId: string) => {
  if (!s3 || !mainWindow) return { ok: false, error: 'Not connected' };
  const name = key.split('/').pop() || key;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: name,
    properties: ['createDirectory'],
  });
  if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };
  try {
    mainWindow?.webContents.send('s3:transferProgress', { id: transferId, progress: 0 });
    await s3.downloadFile(bucket, key, result.filePath, (pct) => {
      mainWindow?.webContents.send('s3:transferProgress', { id: transferId, progress: pct });
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});
```

- [ ] **Step 3: Update `s3:upload` handler**

Replace the `s3:upload` handler. It generates a `transferId` per file internally, sends `s3:transferStarted` before each upload and `s3:transferDone` after. The renderer learns about these transfers via those IPC events — the return value only indicates overall success/failure:

```ts
ipcMain.handle('s3:upload', async (_e, bucket: string, prefix: string) => {
  if (!s3 || !mainWindow) return { ok: false, error: 'Not connected' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return { ok: false, error: 'Cancelled' };
  try {
    for (const filePath of result.filePaths) {
      const name = path.basename(filePath);
      const key = prefix ? prefix + name : name;
      const stat = fs.statSync(filePath);
      const transferId = nextTransferId();
      mainWindow?.webContents.send('s3:transferStarted', {
        id: transferId,
        name,
        direction: 'upload',
        size: stat.size,
      });
      await s3.uploadFile(bucket, key, filePath, (pct) => {
        mainWindow?.webContents.send('s3:transferProgress', { id: transferId, progress: pct });
      });
      mainWindow?.webContents.send('s3:transferDone', { id: transferId, ok: true });
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});
```

Note: `fs` is already imported at the top of `main.ts`.

- [ ] **Step 4: Update `s3:uploadFiles` handler**

Replace the `s3:uploadFiles` handler to accept `transferId`:

```ts
ipcMain.handle('s3:uploadFiles', async (_e, bucket: string, prefix: string, localPaths: string[], transferId: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    for (const filePath of localPaths) {
      const name = path.basename(filePath);
      const key = prefix ? prefix + name : name;
      await s3.uploadFile(bucket, key, filePath, (pct) => {
        mainWindow?.webContents.send('s3:transferProgress', { id: transferId, progress: pct });
      });
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});
```

- [ ] **Step 5: Update `s3:batchDownload` handler**

Replace the `s3:batchDownload` handler to accept `transferId` and send unified progress:

```ts
ipcMain.handle('s3:batchDownload', async (_e, bucket: string, items: { key: string; isFolder: boolean }[], currentPrefix: string, transferId: string) => {
  if (!s3 || !mainWindow) return { ok: false, error: 'Not connected' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select download destination',
    buttonLabel: 'Download Here',
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Cancelled' };
  try {
    const destDir = result.filePaths[0];
    const res = await s3.batchDownload(bucket, items, currentPrefix, destDir, (completed, total, file) => {
      const pct = total > 0 ? Math.round(completed / total * 100) : 0;
      mainWindow?.webContents.send('s3:transferProgress', { id: transferId, progress: pct });
    });
    return { ok: true, ...res };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});
```

- [ ] **Step 6: Verify build**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: wire transferId and progress events into IPC handlers"
```

---

## Task 3: Update preload.ts

**Files:**
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Replace `onDownloadProgress` with unified listeners**

In `preload.ts`, remove the `onDownloadProgress` entry (lines 17–20) and add in its place:

```ts
onTransferProgress: (callback: (data: { id: string; progress: number }) => void) => {
  ipcRenderer.on('s3:transferProgress', (_e, data) => callback(data));
  return () => { ipcRenderer.removeAllListeners('s3:transferProgress'); };
},
onTransferStarted: (callback: (data: { id: string; name: string; direction: 'upload' | 'download'; size: number | null }) => void) => {
  ipcRenderer.on('s3:transferStarted', (_e, data) => callback(data));
  return () => { ipcRenderer.removeAllListeners('s3:transferStarted'); };
},
onTransferDone: (callback: (data: { id: string; ok: boolean; error?: string }) => void) => {
  ipcRenderer.on('s3:transferDone', (_e, data) => callback(data));
  return () => { ipcRenderer.removeAllListeners('s3:transferDone'); };
},
```

- [ ] **Step 2: Update IPC call signatures**

Update these three entries in the `contextBridge.exposeInMainWorld` object:

```ts
download: (bucket: string, key: string, transferId: string) =>
  ipcRenderer.invoke('s3:download', bucket, key, transferId),
batchDownload: (bucket: string, items: { key: string; isFolder: boolean }[], currentPrefix: string, transferId: string) =>
  ipcRenderer.invoke('s3:batchDownload', bucket, items, currentPrefix, transferId),
uploadFiles: (bucket: string, prefix: string, localPaths: string[], transferId: string) =>
  ipcRenderer.invoke('s3:uploadFiles', bucket, prefix, localPaths, transferId),
```

- [ ] **Step 3: Verify build**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat: update preload with unified transfer progress listeners"
```

---

## Task 4: Update useTransfers hook

**Files:**
- Modify: `src/renderer/hooks/useTransfers.ts`

- [ ] **Step 1: Add `addTransferWithId`**

Replace the hook with:

```ts
import { useState, useCallback } from 'react';

let _id = 0;
const nextId = () => `t${++_id}`;

export function useTransfers() {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);

  const addTransfer = useCallback((item: Omit<TransferItem, 'id'>): string => {
    const id = nextId();
    setTransfers(prev => [...prev, { ...item, id }]);
    return id;
  }, []);

  const addTransferWithId = useCallback((id: string, item: Omit<TransferItem, 'id'>) => {
    setTransfers(prev => [...prev, { ...item, id }]);
  }, []);

  const updateTransfer = useCallback((id: string, updates: Partial<TransferItem>) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const clearCompleted = useCallback(() => {
    setTransfers(prev => prev.filter(t => t.status === 'pending' || t.status === 'active'));
  }, []);

  const activeCount = transfers.filter(t => t.status === 'active' || t.status === 'pending').length;

  return { transfers, addTransfer, addTransferWithId, updateTransfer, clearCompleted, activeCount };
}
```

- [ ] **Step 2: Verify build**

```bash
node build-renderer.mjs 2>&1 | head -20
```

Expected: build succeeds, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/useTransfers.ts
git commit -m "feat: add addTransferWithId to useTransfers hook"
```

---

## Task 5: Update App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add `useEffect` import**

At the top of `App.tsx`, ensure `useEffect` is imported:

```ts
import { useState, useCallback, useRef, useEffect } from 'react';
```

- [ ] **Step 2: Destructure `addTransferWithId` from `useTransfers`**

Update line 13:

```ts
const { transfers, addTransfer, addTransferWithId, updateTransfer, clearCompleted, activeCount } = useTransfers();
```

- [ ] **Step 3: Register progress listeners with `useEffect`**

Add this block after the `useTransfers` and `useS3` hook calls (before `handleConnect`):

```ts
useEffect(() => {
  const unsubProgress = api.onTransferProgress(({ id, progress }) => {
    updateTransfer(id, { progress });
  });
  const unsubStarted = api.onTransferStarted(({ id, name, direction, size }) => {
    addTransferWithId(id, { name, direction, status: 'active', progress: 0, size });
  });
  const unsubDone = api.onTransferDone(({ id, ok, error }) => {
    updateTransfer(id, { status: ok ? 'done' : 'error', progress: ok ? 100 : undefined, error });
  });
  return () => { unsubProgress(); unsubStarted(); unsubDone(); };
}, []);
```

- [ ] **Step 4: Update `handleUploadFiles` to pass `transferId`**

Replace the existing `handleUploadFiles` function:

```ts
const handleUploadFiles = async (paths: string[]) => {
  if (!s3.currentBucket) return;
  for (const p of paths) {
    const name = p.split('/').pop() || p;
    const id = addTransfer({ name, direction: 'upload', status: 'active', progress: 0, size: null });
    const res = await api.uploadFiles(s3.currentBucket, s3.prefix, [p], id);
    updateTransfer(id, { status: res.ok ? 'done' : 'error', progress: res.ok ? 100 : undefined, error: res.error });
  }
  s3.refresh();
};
```

- [ ] **Step 5: Verify renderer build**

```bash
node build-renderer.mjs 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: register transfer progress listeners in App.tsx"
```

---

## Task 6: Update S3Pane.tsx

**Files:**
- Modify: `src/renderer/components/S3Pane.tsx`

- [ ] **Step 1: Replace the entire `useEffect` at lines 75–84**

The existing `useEffect` at lines 75–84 subscribes to **both** `api.onDownloadProgress` (the old channel being retired) and `api.onEmptyProgress`. Remove the whole block and replace it with a new `useEffect` that only retains `onEmptyProgress`:

```ts
useEffect(() => {
  const cleanupEmpty = api.onEmptyProgress(data => setEmptyProgress(data.deleted));
  return () => { cleanupEmpty(); };
}, []);
```

Batch download progress is now shown in the TransferBar via `onTransferProgress` — the `downloadProgress` inline UI in this component will be removed in Step 4.

- [ ] **Step 2: Update `handleDownload` to pass `transferId`**

Replace the existing `handleDownload`:

```ts
const handleDownload = async (item: S3Item) => {
  if (!currentBucket) return;
  const id = onAddTransfer({ name: item.name, direction: 'download', status: 'active', progress: 0, size: item.size });
  const res = await api.download(currentBucket, item.key, id);
  onUpdateTransfer(id, { status: res.ok ? 'done' : 'error', progress: res.ok ? 100 : undefined, error: res.error });
  if (!res.ok && res.error !== 'Cancelled') onError(res.error || 'Download failed');
};
```

- [ ] **Step 3: Update `handleBatchDownload` to pass `transferId`**

Replace the existing `handleBatchDownload`:

```ts
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
```

- [ ] **Step 4: Remove `downloadProgress` state and inline progress UI**

Remove the `downloadProgress` state declaration (line 73) and the inline JSX that renders it (the block starting at line 377). Batch download progress is now shown in the TransferBar at the bottom.

- [ ] **Step 5: Verify full build**

```bash
cd /Users/guanliu/Desktop/kiro/S3-MacClient/s3-client
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/S3Pane.tsx
git commit -m "feat: migrate S3Pane download to unified transfer progress channel"
```

---

## Task 7: Smoke test

- [ ] **Step 1: Start the app**

```bash
npm start
```

- [ ] **Step 2: Test upload progress**
  - Connect to an S3 bucket
  - Upload a file > 64 MB via drag-and-drop or Upload button
  - Verify TransferBar shows the file name with an animating progress bar that counts from 0% to 100%

- [ ] **Step 3: Test download progress**
  - Right-click a file and choose Download
  - Verify TransferBar shows a progress bar counting from 0% to 100% during the download

- [ ] **Step 4: Test batch download progress**
  - Select multiple files, click Download
  - Verify TransferBar shows a single "N files" entry with progress counting as each file completes

- [ ] **Step 5: Test small file upload**
  - Upload a file < 64 MB
  - Verify it shows as active in the TransferBar and transitions to done (no intermediate percentages expected)

- [ ] **Step 6: Final commit**

```bash
git add -A
git status  # confirm clean or only expected changes
git commit -m "feat: transfer progress display complete" --allow-empty
```
