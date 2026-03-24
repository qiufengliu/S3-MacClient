import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('s3api', {
  // Connection
  connect: (config: { auth: any; transfer?: any }) =>
    ipcRenderer.invoke('s3:connect', config),
  listBuckets: () => ipcRenderer.invoke('s3:listBuckets'),
  getBucketInfo: (bucket: string) => ipcRenderer.invoke('s3:getBucketInfo', bucket),

  // Objects
  listObjects: (bucket: string, prefix: string) =>
    ipcRenderer.invoke('s3:listObjects', bucket, prefix),
  download: (bucket: string, key: string) =>
    ipcRenderer.invoke('s3:download', bucket, key),
  batchDownload: (bucket: string, items: { key: string; isFolder: boolean }[], currentPrefix: string) =>
    ipcRenderer.invoke('s3:batchDownload', bucket, items, currentPrefix),
  onDownloadProgress: (callback: (data: { completed: number; total: number; file: string }) => void) => {
    ipcRenderer.on('s3:downloadProgress', (_e, data) => callback(data));
    return () => { ipcRenderer.removeAllListeners('s3:downloadProgress'); };
  },
  upload: (bucket: string, prefix: string) =>
    ipcRenderer.invoke('s3:upload', bucket, prefix),
  uploadFiles: (bucket: string, prefix: string, localPaths: string[]) =>
    ipcRenderer.invoke('s3:uploadFiles', bucket, prefix, localPaths),
  delete: (bucket: string, key: string) =>
    ipcRenderer.invoke('s3:delete', bucket, key),
  batchDelete: (bucket: string, keys: string[]) =>
    ipcRenderer.invoke('s3:batchDelete', bucket, keys),
  createFolder: (bucket: string, key: string) =>
    ipcRenderer.invoke('s3:createFolder', bucket, key),

  // Bucket management
  emptyBucket: (bucket: string) =>
    ipcRenderer.invoke('s3:emptyBucket', bucket),
  deleteBucket: (bucket: string) =>
    ipcRenderer.invoke('s3:deleteBucket', bucket),
  onEmptyProgress: (callback: (data: { bucket: string; deleted: number }) => void) => {
    ipcRenderer.on('s3:emptyProgress', (_e, data) => callback(data));
    return () => { ipcRenderer.removeAllListeners('s3:emptyProgress'); };
  },

  // Transfer config
  getTransferConfig: () => ipcRenderer.invoke('s3:getTransferConfig'),
  updateTransferConfig: (config: any) =>
    ipcRenderer.invoke('s3:updateTransferConfig', config),

  // Preview
  previewObject: (bucket: string, key: string) =>
    ipcRenderer.invoke('s3:previewObject', bucket, key),

  // Presigned URL
  presign: (bucket: string, key: string, expiresIn: number) =>
    ipcRenderer.invoke('s3:presign', bucket, key, expiresIn),

  // Rename
  rename: (bucket: string, oldKey: string, newKey: string) =>
    ipcRenderer.invoke('s3:rename', bucket, oldKey, newKey),

  // Versions
  listVersions: (bucket: string, key: string) =>
    ipcRenderer.invoke('s3:listVersions', bucket, key),
  restoreVersion: (bucket: string, key: string, versionId: string) =>
    ipcRenderer.invoke('s3:restoreVersion', bucket, key, versionId),
  deleteVersion: (bucket: string, key: string, versionId: string) =>
    ipcRenderer.invoke('s3:deleteVersion', bucket, key, versionId),

  // Bucket policy
  getBucketPolicy: (bucket: string) =>
    ipcRenderer.invoke('s3:getBucketPolicy', bucket),

  // Sync
  sync: (localDir: string, bucket: string, prefix: string) =>
    ipcRenderer.invoke('s3:sync', localDir, bucket, prefix),
  onSyncProgress: (callback: (data: { item: string }) => void) => {
    ipcRenderer.on('s3:syncProgress', (_e, data) => callback(data));
    return () => { ipcRenderer.removeAllListeners('s3:syncProgress'); };
  },

  // Saved connections
  connList: () => ipcRenderer.invoke('conn:list'),
  connSave: (connection: any, rawSecret?: string) =>
    ipcRenderer.invoke('conn:save', connection, rawSecret),
  connDelete: (id: string) => ipcRenderer.invoke('conn:delete', id),

  // Local filesystem
  localReadDir: (dirPath: string) => ipcRenderer.invoke('local:readDir', dirPath),
});
