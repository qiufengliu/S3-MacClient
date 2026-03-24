import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { S3Service } from './s3service';

const PREVIEW_IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','svg','webp','bmp','ico']);
const PREVIEW_VIDEO_EXTS = new Set(['mp4','mov','webm','m4v','mkv']);

let mainWindow: BrowserWindow | null = null;
let s3: S3Service | null = null;

app.setName('Mac S3 Client');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Mac S3 Client',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// --- Connections persistence ---

const connectionsPath = () => path.join(app.getPath('userData'), 'connections.json');

function loadConnections(): any[] {
  try {
    const raw = fs.readFileSync(connectionsPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveConnections(connections: any[]) {
  fs.writeFileSync(connectionsPath(), JSON.stringify(connections, null, 2), 'utf-8');
}

ipcMain.handle('conn:list', async () => {
  try {
    const conns = loadConnections();
    // Strip encryptedSecret before sending to renderer
    return { ok: true, connections: conns.map(({ encryptedSecret: _s, ...rest }) => rest) };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('conn:save', async (_e, connection: any, rawSecret?: string) => {
  try {
    const conns = loadConnections();
    const entry: any = { ...connection };
    if (rawSecret && safeStorage.isEncryptionAvailable()) {
      entry.encryptedSecret = safeStorage.encryptString(rawSecret).toString('base64');
    }
    const idx = conns.findIndex(c => c.id === connection.id);
    if (idx >= 0) conns[idx] = entry;
    else conns.push(entry);
    saveConnections(conns);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('conn:delete', async (_e, id: string) => {
  try {
    const conns = loadConnections().filter(c => c.id !== id);
    saveConnections(conns);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// --- Local filesystem ---

ipcMain.handle('local:readDir', async (_e, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = entries.map(e => {
      const full = path.join(dirPath, e.name);
      let size: number | null = null;
      let mtime: string | null = null;
      try {
        const stat = fs.statSync(full);
        size = e.isDirectory() ? null : stat.size;
        mtime = stat.mtime.toISOString();
      } catch { /* ignore */ }
      return { name: e.name, path: full, size, mtime, isDir: e.isDirectory() };
    });
    return { ok: true, items };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// --- S3 IPC Handlers ---

ipcMain.handle('s3:connect', async (_e, config: { auth: any; transfer?: any }) => {
  try {
    let auth = { ...config.auth };
    // Decrypt secret if connecting via saved connection with encryptedSecret
    if (auth.encryptedSecret && safeStorage.isEncryptionAvailable()) {
      auth.secretAccessKey = safeStorage.decryptString(Buffer.from(auth.encryptedSecret, 'base64'));
      delete auth.encryptedSecret;
    }
    s3 = new S3Service(auth, config.transfer);
    const buckets = await s3.listBuckets();
    return { ok: true, buckets };
  } catch (err: any) {
    s3 = null;
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:getTransferConfig', async () => {
  if (!s3) return { ok: false, error: 'Not connected' };
  return { ok: true, config: s3.getTransferConfig() };
});

ipcMain.handle('s3:updateTransferConfig', async (_e, config: any) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  s3.updateTransferConfig(config);
  return { ok: true, config: s3.getTransferConfig() };
});

ipcMain.handle('s3:listBuckets', async () => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    return { ok: true, buckets: await s3.listBuckets() };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:getBucketInfo', async (_e, bucket: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    const info = await s3.getBucketInfo(bucket);
    return { ok: true, info };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:listObjects', async (_e, bucket: string, prefix: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    return { ok: true, items: await s3.listObjects(bucket, prefix) };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:download', async (_e, bucket: string, key: string) => {
  if (!s3 || !mainWindow) return { ok: false, error: 'Not connected' };
  const name = key.split('/').pop() || key;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: name,
    properties: ['createDirectory'],
  });
  if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };
  try {
    await s3.downloadFile(bucket, key, result.filePath);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:batchDownload', async (_e, bucket: string, items: { key: string; isFolder: boolean }[], currentPrefix: string) => {
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
      mainWindow?.webContents.send('s3:downloadProgress', { completed, total, file });
    });
    return { ok: true, ...res };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

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
      await s3.uploadFile(bucket, key, filePath);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:uploadFiles', async (_e, bucket: string, prefix: string, localPaths: string[]) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    for (const filePath of localPaths) {
      const name = path.basename(filePath);
      const key = prefix ? prefix + name : name;
      await s3.uploadFile(bucket, key, filePath);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:delete', async (_e, bucket: string, key: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    await s3.deleteObject(bucket, key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:batchDelete', async (_e, bucket: string, keys: string[]) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    await s3.batchDeleteObjects(bucket, keys);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:createFolder', async (_e, bucket: string, key: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    await s3.createFolder(bucket, key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:emptyBucket', async (_e, bucket: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    const deleted = await s3.emptyBucket(bucket, (count) => {
      mainWindow?.webContents.send('s3:emptyProgress', { bucket, deleted: count });
    });
    return { ok: true, deleted };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:deleteBucket', async (_e, bucket: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    await s3.deleteBucket(bucket);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:previewObject', async (_e, bucket: string, key: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  const ext = (key.split('.').pop() || '').toLowerCase();
  try {
    if (PREVIEW_IMAGE_EXTS.has(ext)) {
      const buf = await s3.getObjectBuffer(bucket, key);
      const mime = ext === 'svg' ? 'image/svg+xml'
        : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
        : `image/${ext}`;
      return { ok: true, type: 'image', dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
    } else if (PREVIEW_VIDEO_EXTS.has(ext)) {
      const name = key.split('/').pop() || 'preview';
      const tmpPath = path.join(os.tmpdir(), `s3preview-${Date.now()}-${name}`);
      await s3.downloadFile(bucket, key, tmpPath);
      return { ok: true, type: 'video', filePath: tmpPath };
    }
    return { ok: false, error: 'Unsupported file type for preview' };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:presign', async (_e, bucket: string, key: string, expiresIn: number) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    const url = await s3.getPresignedUrl(bucket, key, expiresIn);
    return { ok: true, url };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:rename', async (_e, bucket: string, oldKey: string, newKey: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    await s3.renameObject(bucket, oldKey, newKey);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:listVersions', async (_e, bucket: string, key: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    const versions = await s3.listObjectVersions(bucket, key);
    return { ok: true, versions };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:restoreVersion', async (_e, bucket: string, key: string, versionId: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    await s3.restoreVersion(bucket, key, versionId);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:deleteVersion', async (_e, bucket: string, key: string, versionId: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    await s3.deleteVersion(bucket, key, versionId);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:getBucketPolicy', async (_e, bucket: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    const policy = await s3.getBucketPolicy(bucket);
    return { ok: true, policy };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('s3:sync', async (_e, localDir: string, bucket: string, prefix: string) => {
  if (!s3) return { ok: false, error: 'Not connected' };
  try {
    const cfg = s3.getTransferConfig();
    const result = await s3.syncLocalToS3(localDir, bucket, prefix,
      { concurrency: cfg.concurrency, multipartThresholdMB: cfg.multipartThresholdMB },
      (item) => mainWindow?.webContents.send('s3:syncProgress', { item })
    );
    return { ok: true, result };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});
