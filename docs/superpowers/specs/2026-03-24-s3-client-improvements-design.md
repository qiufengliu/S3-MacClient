# S3 MacClient Improvements — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Scope:** All priority levels (High + Medium + Low)

---

## Overview

Upgrade the existing Electron + React S3 desktop client from a single-file prototype into a production-quality tool. The improvements span architecture refactoring, UI redesign, and a full feature expansion across three priority tiers.

Key decisions:
- **Style:** Dark + AWS orange accent (`#f0883e`)
- **Layout:** Dual-pane (Local filesystem ↔ S3)
- **Connections:** Single connection at a time with saved profiles
- **Architecture:** Component split + feature addition (no full rewrite)

---

## Architecture

### Component Structure

```
src/
├── main/
│   ├── main.ts           — IPC handlers (extended with new operations)
│   ├── s3service.ts      — S3 operations (extended)
│   └── preload.ts        — contextBridge API (extended)
└── renderer/
    ├── index.tsx         — React mount point (imports theme.css)
    ├── types.d.ts        — Global type declarations (extended)
    ├── theme.css         — CSS variables for AWS dark theme
    ├── App.tsx           — Top-level layout + state coordinator (slimmed down)
    ├── components/
    │   ├── ConnectionPanel.tsx   — Saved connections list + new connection form
    │   ├── S3Pane.tsx            — Right-side S3 browser (bucket list + file list)
    │   ├── LocalPane.tsx         — Left-side local filesystem browser
    │   ├── FileTable.tsx         — Shared sortable file table with checkboxes
    │   ├── ContextMenu.tsx       — Right-click context menu (S3 + Local variants)
    │   ├── TransferBar.tsx       — Bottom collapsible transfer progress + history
    │   ├── PreviewModal.tsx      — Image/video preview modal (extracted from App)
    │   ├── VersionsModal.tsx     — S3 object version history viewer
    │   └── SyncModal.tsx         — Local-to-S3 folder sync configuration
    └── hooks/
        ├── useLocalFS.ts         — Local filesystem directory reading
        ├── useS3.ts              — S3 operations state (bucket, prefix, items)
        └── useTransfers.ts       — Transfer queue + history management
```

### State Management

No external state management library (Redux, Zustand, etc.). Use **React Context + useReducer** for cross-component state (active connection, transfer queue). Local UI state stays inside each component. No new frontend libraries.

### Persistence

- Saved connections stored in `app.getPath('userData')/connections.json`
- Schema per connection: `{ id, name, mode, profile?, accessKeyId?, region, endpoint?, encryptedSecret? }`
- For `mode: 'keys'`: `accessKeyId` is stored in plain text (non-secret); the `secretAccessKey` is encrypted via **Electron's built-in `safeStorage` API** (available since Electron 15, uses macOS Keychain under the hood, zero native dependencies) and stored as `encryptedSecret` (base64-encoded Buffer) in `connections.json`
- Encryption: `safeStorage.encryptString(secret)` → base64 → stored; Decryption: `safeStorage.decryptString(Buffer.from(b64, 'base64'))` → used at connect time
- No native addons required; no rebuild step needed
- Transfer history stored in-memory only (cleared on app restart)

---

## Theme

CSS variables defined in `theme.css`, imported by `index.tsx`. esbuild's CSS loader is enabled by adding `'.css': 'css'` to `build-renderer.mjs`. The existing inline `<style>` block in `index.html` is removed.

```css
:root {
  --bg:        #0d1117;   /* page background */
  --surface:   #161b22;   /* panels, cards */
  --border:    #21262d;   /* dividers */
  --border2:   #30363d;   /* input borders */
  --text:      #e6edf3;   /* primary text */
  --text2:     #8b949e;   /* secondary text */
  --accent:    #f0883e;   /* AWS orange — primary actions, active states */
  --accent-bg: #f0883e15; /* accent tint for selected rows */
  --success:   #3fb950;
  --warning:   #e3b341;
  --danger:    #f85149;
}
```

---

## New Type Definitions

### In `src/renderer/types.d.ts`

```typescript
interface LocalItem {
  name: string;
  path: string;
  size: number | null;
  mtime: string | null;  // ISO string
  isDir: boolean;
}

interface SavedConnection {
  id: string;
  name: string;
  mode: 'profile' | 'keys';
  profile?: string;
  accessKeyId?: string;       // stored in plain text (non-secret)
  encryptedSecret?: string;   // base64-encoded encrypted secretAccessKey
  region: string;
  endpoint?: string;
}

interface TransferItem {
  id: string;
  name: string;
  direction: 'upload' | 'download';
  status: 'pending' | 'active' | 'done' | 'error';
  progress: number;  // 0–100
  size: number | null;
  error?: string;
}
```

### In `src/main/s3service.ts` (exported)

```typescript
export interface Version {
  versionId: string;
  size: number;
  lastModified: string;  // ISO string
  isLatest: boolean;
}

export interface SyncResult {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}
```

---

## Features

### High Priority

#### 1. Credential Persistence (safeStorage)

- New `ConnectionPanel` component replaces the login card
- Lists saved connections from `connections.json`; click to connect instantly
- "New Connection" form: non-sensitive fields + `accessKeyId` saved to `connections.json`; `secretAccessKey` encrypted via `safeStorage.encryptString()` and stored as `encryptedSecret` in the same file
- IPC handlers: `conn:list`, `conn:save`, `conn:delete`
- At connect time: main process decrypts `encryptedSecret` locally and passes the plain secret to `S3Service` constructor — secret never travels through IPC unencrypted

#### 2. Dual-Pane Layout (Local ↔ S3)

- `App.tsx` renders `<LocalPane>` (left) and `<S3Pane>` (right) side by side
- A thin orange-tinted divider separates the two panes
- Drag files from `LocalPane` to `S3Pane` triggers upload to current S3 prefix
- "Upload to S3" button in LocalPane status bar uploads selected local files using `s3:uploadFiles` IPC
- "Download to here" button in S3Pane status bar downloads selected S3 files to current local directory

#### 3. Right-Click Context Menu

- `ContextMenu` component: positioned absolutely, closes on outside click or Escape
- **S3 side menu items:** Download, Preview, Rename, Copy Presigned URL, Version History, Delete
- **Local side menu items:** Upload to S3, Open in Finder, Delete
- Replaces all inline action buttons in file rows (rows become cleaner)

#### 4. Presigned URL Generation

- `s3service.getPresignedUrl(bucket, key, expiresSeconds)` using `@aws-sdk/s3-request-presigner`
- Right-click → "Copy Presigned URL" → small popover to pick expiry (15 min / 1 h / 24 h / 7 days) → URL copied to clipboard
- IPC handler: `s3:presign`

#### 5. Custom Endpoint (S3-Compatible Storage)

- Connection form gains optional "Custom Endpoint" field
- Supports MinIO, Cloudflare R2, Tencent COS, Alibaba OSS, DigitalOcean Spaces
- `S3Client` constructed with `endpoint` + `forcePathStyle: true` when endpoint is set
- Endpoint stored in `connections.json`

---

### Medium Priority

#### 6. Column Sorting

- `FileTable` component accepts `sortKey` + `sortDir` props
- Clicking a column header cycles: none → asc → desc
- Sort keys: `name`, `size`, `lastModified`, `storageClass`
- Folders always sorted to top regardless of sort direction

#### 7. Batch Delete

- Multi-select → toolbar shows "Delete (N)" button
- Calls `s3:batchDelete` IPC → `s3service.batchDeleteObjects(bucket, keys)` which wraps `DeleteObjectsCommand` in batches of ≤1000 keys
- Replaces `window.confirm()` with an inline confirmation banner above the file list
- Same pattern applied to single-file delete (no more browser dialogs)

#### 8. Transfer History Panel

- `TransferBar` renders at the bottom of the window, collapsible
- `useTransfers` hook maintains an array of `TransferItem`
- Active transfers show a progress bar; completed/failed entries persist in the list
- "Clear history" button clears completed/failed entries

#### 9. File Rename

- `s3service.renameObject(bucket, oldKey, newKey)` = `CopyObject` + `DeleteObject`
- Entry point: right-click → Rename → inline text input replaces the filename cell
- Press Enter to confirm, Escape to cancel
- Works for files only; folders show rename as disabled

#### 10. Storage Class Column

- `ListObjectsV2` already returns `StorageClass` per object
- `FileTable` adds an optional "Type" column: `STANDARD` / `IA` / `GLACIER` / etc.
- Column visible by default; can be hidden via column header right-click

---

### Low Priority

#### 11. Object Version History

- `VersionsModal` lists all versions via `ListObjectVersionsCommand`
- Columns: Version ID, Size, Last Modified, Is Latest
- Actions per version: Restore (copy version to current), Download, Delete version
- Only shown when bucket has versioning enabled (checked via `GetBucketVersioningCommand`)

#### 12. Folder Sync (Local → S3)

- `SyncModal` lets user pick a local directory and an S3 prefix
- **Sync algorithm:**
  - For each local file: if no matching S3 key exists → upload
  - If sizes differ → upload
  - If sizes match AND file is below the multipart threshold (64 MB) → compare local MD5 against S3 ETag (which equals MD5 for simple uploads); if different → upload
  - If sizes match AND file is above threshold → size-only comparison (ETag for multipart uploads is not computable locally); mark as "assumed unchanged" in the diff preview
- Shows a diff preview (files to upload, files assumed unchanged, files skipped) before starting
- Runs sync with same concurrency as transfer config
- One-way only (local → S3) to minimize complexity and risk

#### 13. Bucket Policy Viewer

- Right-click on bucket in S3Pane sidebar → "View Policy"
- `GetBucketPolicyCommand` → display formatted JSON in a read-only code block
- No editing — view only to avoid accidental misconfiguration

---

## IPC Handler Reference

### New S3 handlers in `main.ts`

| Handler | Arguments | Description |
|---|---|---|
| `s3:uploadFiles` | `bucket, prefix, localPaths: string[]` | Upload specific local files (replaces dialog-based `s3:upload` for LocalPane) |
| `s3:batchDelete` | `bucket, keys: string[]` | Delete multiple objects (batches of ≤1000) |
| `s3:presign` | `bucket, key, expiresIn: number` | Generate presigned URL |
| `s3:rename` | `bucket, oldKey, newKey` | CopyObject + DeleteObject |
| `s3:listVersions` | `bucket, key` | List all versions of a single object |
| `s3:restoreVersion` | `bucket, key, versionId` | Copy old version to current |
| `s3:deleteVersion` | `bucket, key, versionId` | Delete a specific version |
| `s3:getBucketPolicy` | `bucket` | Return bucket policy as JSON string |
| `s3:sync` | `localDir, bucket, prefix` | Run local→S3 folder sync |

Note: the existing `s3:upload` handler (dialog-based) is kept for backward compatibility.

### New connection handlers in `main.ts`

| Handler | Arguments | Description |
|---|---|---|
| `conn:list` | — | Return all `SavedConnection[]` from connections.json (no secrets) |
| `conn:save` | `connection: SavedConnection, rawSecret?: string` | Save connection; if `rawSecret` is provided, main process encrypts it via `safeStorage.encryptString()` and stores the result as `encryptedSecret` before writing. Raw secret travels over the local Unix IPC socket (standard Electron approach — no external network exposure). |
| `conn:delete` | `id: string` | Remove connection from connections.json |

### New local filesystem handler in `main.ts`

| Handler | Arguments | Description |
|---|---|---|
| `local:readDir` | `dirPath: string` | Return `LocalItem[]` for a directory |

---

## S3 Service Extensions

New methods added to `s3service.ts`:

```typescript
getPresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string>
renameObject(bucket: string, oldKey: string, newKey: string): Promise<void>
batchDeleteObjects(bucket: string, keys: string[]): Promise<void>
listObjectVersions(bucket: string, key: string): Promise<Version[]>
restoreVersion(bucket: string, key: string, versionId: string): Promise<void>
deleteVersion(bucket: string, key: string, versionId: string): Promise<void>
getBucketPolicy(bucket: string): Promise<string>
syncLocalToS3(localDir: string, bucket: string, prefix: string, opts: { concurrency: number; multipartThresholdMB: number }, onProgress?: (item: string) => void): Promise<SyncResult>
```

---

## New Dependencies

| Package | Purpose | Type |
|---|---|---|
| `@aws-sdk/s3-request-presigner` | Presigned URL generation | runtime |

`safeStorage` is a built-in Electron API — no additional package needed. No native addons.

---

## Feature Documentation

A `FEATURES.md` file will be written to the project root documenting all implemented features for end users.

---

## Out of Scope

- Multiple simultaneous connections / tabs
- CloudFront management
- Bucket ACL editing
- IAM management
- Windows/Linux support changes
- Auto-update
