# Transfer Progress Display — Design Spec

Date: 2026-03-25

## Problem

The TransferBar UI already renders a progress bar and percentage for active transfers, but progress jumps directly from 0% to 100% with no intermediate updates. Users have no visibility into large file transfer status.

## Goals

- Show real-time byte-level progress for large file uploads (≥ 64 MB, multipart)
- Show real-time byte-level progress for all file downloads (any size)
- Show per-file completion count for batch downloads
- Small file uploads (< 64 MB) remain unchanged: show active spinner until done

## Non-Goals

- Byte-level progress for small uploads (< 64 MB) — too fast to matter, single PutObjectCommand has no progress hook
- Transfer pause/cancel
- Speed (MB/s) display

## Architecture

Progress flows from S3 SDK → s3service.ts → IPC (main.ts) → renderer (App.tsx) → TransferBar.

### Layer 1: s3service.ts

**`downloadFile(bucket, key, destPath, onProgress?)`**

Add optional `onProgress: (pct: number) => void` parameter. Use `res.ContentLength` from GetObjectCommand response as total bytes. Wrap the response stream in a PassThrough that counts bytes and calls `onProgress(Math.round(loaded / total * 100))` on each `data` event. If `ContentLength` is absent, skip progress calls entirely.

**`multipartUpload(bucket, key, filePath, fileSize, onProgress?)`**

Add optional `onProgress: (pct: number) => void`. Track completed parts with a `let completedParts = 0` counter. Inside each part's `.then()` callback, increment `completedParts++` then call `onProgress(Math.round(completedParts / totalParts * 100))`. This is safe because JS Promise `.then()` callbacks execute on the microtask queue sequentially, so the increment is not subject to data races.

**`uploadFile(bucket, key, filePath, onProgress?)`**

Thread the callback through to `multipartUpload` for large files. Ignore for small files (< multipartThresholdMB).

**`batchDownload(... onProgress?)`**

Already accepts `(completed, total, file)` callback — no change needed to the method signature.

### Layer 2: main.ts (IPC handlers)

A unified `s3:transferProgress` IPC channel replaces the existing `s3:downloadProgress` channel for individual file transfers. The existing `s3:downloadProgress` channel (used by `s3:batchDownload`) is **retired** and migrated to `s3:transferProgress` as well.

Affected handlers:

**`s3:download`** — add `transferId: string` as a third argument `(_e, bucket, key, transferId)`. After opening `showSaveDialog` and before downloading, call `mainWindow.webContents.send('s3:transferProgress', { id: transferId, progress: 0 })`. Pass `onProgress` to `downloadFile` which sends progress events during streaming.

**`s3:upload`** — the handler opens `showOpenDialog` internally and may return multiple files. Each selected file gets its own transfer entry. The handler generates one `transferId` per file internally (using a simple counter or uuid), sends `s3:transferStarted` events to the renderer for each file before uploading, then sends `s3:transferProgress` events during upload. The renderer's `addTransfer` call moves to an `s3:transferStarted` listener rather than being called before `api.upload()`.

**`s3:uploadFiles`** — add `transferId: string` as the fourth argument. Since files are uploaded sequentially one per call (App.tsx already loops one file per `api.uploadFiles` call), a single `transferId` covers one file. Pass `onProgress` to `uploadFile`.

**`s3:batchDownload`** — migrate from sending `s3:downloadProgress` to sending `s3:transferProgress` with `{ id: transferId, progress: Math.round(completed / total * 100) }`. Add `transferId` as a parameter.

### Layer 3: preload.ts

**Remove** `onDownloadProgress` (it used `s3:downloadProgress` which is now retired).

**Add** a unified progress listener:

```ts
onTransferProgress: (callback: (data: { id: string; progress: number }) => void) => {
  ipcRenderer.on('s3:transferProgress', (_e, data) => callback(data));
  return () => { ipcRenderer.removeAllListeners('s3:transferProgress'); };
},
onTransferStarted: (callback: (data: { id: string; name: string; direction: 'upload' | 'download'; size: number | null }) => void) => {
  ipcRenderer.on('s3:transferStarted', (_e, data) => callback(data));
  return () => { ipcRenderer.removeAllListeners('s3:transferStarted'); };
},
```

Update signatures:
- `download(bucket, key, transferId)` — adds `transferId` param
- `uploadFiles(bucket, prefix, localPaths, transferId)` — adds `transferId` param
- `upload(bucket, prefix)` — unchanged (transfer ids are generated inside main for this path)
- `batchDownload(bucket, items, currentPrefix, transferId)` — adds `transferId` param

### Layer 4: App.tsx (renderer)

Register listeners on mount with cleanup:

```ts
useEffect(() => {
  const unsubProgress = api.onTransferProgress(({ id, progress }) => {
    updateTransfer(id, { progress });
  });
  const unsubStarted = api.onTransferStarted(({ id, name, direction, size }) => {
    // For s3:upload path where main generates the id
    addTransferWithId(id, { name, direction, status: 'active', progress: 0, size });
  });
  return () => { unsubProgress(); unsubStarted(); };
}, []);
```

`useTransfers` hook adds `addTransferWithId(id, item)` alongside the existing `addTransfer`.

For `s3:uploadFiles` path (`handleUploadFiles`), the renderer still generates the id:
```ts
const id = addTransfer({ name, direction: 'upload', status: 'active', progress: 0, size: null });
const res = await api.uploadFiles(bucket, prefix, [p], id);
updateTransfer(id, { status: res.ok ? 'done' : 'error', error: res.error });
```

For `s3:download`, the renderer generates the id and passes it:
```ts
const id = addTransfer({ name, direction: 'download', status: 'active', progress: 0, size: null });
const res = await api.download(bucket, key, id);
updateTransfer(id, { status: res.ok ? 'done' : 'error', error: res.error });
```

The download action currently lives in `S3Pane.tsx` — it needs to accept `onAddTransfer` and `onUpdateTransfer` props (already passed from App.tsx) and use them to manage the transfer id around the `api.download` call.

## Data Flow

```
uploadFiles path:
  renderer: id = addTransfer() → api.uploadFiles(... id)
  main: s3service.uploadFile(onProgress) → webContents.send('s3:transferProgress', { id, pct })
  renderer: onTransferProgress → updateTransfer(id, { progress: pct })
  renderer: IPC resolves → updateTransfer(id, { status: 'done' })

upload (dialog) path:
  renderer: api.upload(bucket, prefix)
  main: showOpenDialog → for each file: send('s3:transferStarted', { id, name }) → s3service.uploadFile(onProgress) → send('s3:transferProgress', { id, pct })
  renderer: onTransferStarted → addTransferWithId(id, ...) ; onTransferProgress → updateTransfer(id, { progress })
  main: sends s3:transferDone per file → renderer onTransferDone → updateTransfer each id to done/error

download path:
  renderer: id = addTransfer() → api.download(bucket, key, id)
  main: showSaveDialog → s3service.downloadFile(onProgress) → send('s3:transferProgress', { id, pct })
  renderer: onTransferProgress → updateTransfer(id, { progress: pct })
  renderer: IPC resolves → updateTransfer(id, { status: 'done' })
```

## Files to Modify

| File | Change |
|------|--------|
| `src/main/s3service.ts` | Add `onProgress` to `downloadFile`, `multipartUpload`, `uploadFile` |
| `src/main/main.ts` | Accept `transferId` in IPC handlers; generate ids for `s3:upload`; send `s3:transferProgress` and `s3:transferStarted` events; migrate `s3:batchDownload` off `s3:downloadProgress` |
| `src/main/preload.ts` | Remove `onDownloadProgress`; add `onTransferProgress`, `onTransferStarted`; update `download`, `uploadFiles`, `batchDownload` signatures |
| `src/renderer/App.tsx` | Register `onTransferProgress` and `onTransferStarted` in `useEffect` with cleanup; pass ids to IPC calls |
| `src/renderer/hooks/useTransfers.ts` | Add `addTransferWithId(id, item)` |
| `src/renderer/components/S3Pane.tsx` | Use `onAddTransfer`/`onUpdateTransfer` props around `api.download` call |

## Edge Cases

- If `ContentLength` is absent on download response, skip progress updates (transfer shows as active until done)
- If `mainWindow` is null when a progress event fires, skip the send
- If the user cancels the save/open dialog in `s3:download` or `s3:upload`, send no progress events and return `{ ok: false, error: 'Cancelled' }`; the renderer sets transfer status to `error` on receiving that response
- The `s3:upload` handler sends `s3:transferDone` events per file so the renderer can mark each generated transfer as done or error; the IPC return value only needs `{ ok: boolean }`
