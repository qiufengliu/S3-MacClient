interface S3Item {
  key: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  isFolder: boolean;
  storageClass?: string;
}

interface LocalItem {
  name: string;
  path: string;
  size: number | null;
  mtime: string | null;
  isDir: boolean;
}

interface SavedConnection {
  id: string;
  name: string;
  mode: 'profile' | 'keys';
  profile?: string;
  accessKeyId?: string;
  encryptedSecret?: string;
  region: string;
}

interface TransferItem {
  id: string;
  name: string;
  direction: 'upload' | 'download';
  status: 'pending' | 'active' | 'done' | 'error';
  progress: number;
  size: number | null;
  error?: string;
}

interface Version {
  versionId: string;
  size: number;
  lastModified: string;
  isLatest: boolean;
}

interface SyncResult {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface AuthConfig {
  mode: 'profile' | 'keys';
  profile?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region: string;
}

interface TransferConfig {
  multipartThresholdMB: number;
  partSizeMB: number;
  concurrency: number;
  timeoutSeconds: number;
}

interface BucketInfo {
  region: string;
}

interface S3Api {
  connect(config: { auth: AuthConfig; transfer?: TransferConfig }): Promise<{ ok: boolean; buckets?: string[]; error?: string }>;
  listBuckets(): Promise<{ ok: boolean; buckets?: string[]; error?: string }>;
  getBucketInfo(bucket: string): Promise<{ ok: boolean; info?: BucketInfo; error?: string }>;
  listObjects(bucket: string, prefix: string): Promise<{ ok: boolean; items?: S3Item[]; error?: string }>;
  download(bucket: string, key: string): Promise<{ ok: boolean; error?: string }>;
  batchDownload(bucket: string, items: { key: string; isFolder: boolean }[], currentPrefix: string): Promise<{ ok: boolean; succeeded?: number; failed?: number; errors?: string[]; error?: string }>;
  onDownloadProgress(callback: (data: { completed: number; total: number; file: string }) => void): () => void;
  upload(bucket: string, prefix: string): Promise<{ ok: boolean; error?: string }>;
  uploadFiles(bucket: string, prefix: string, localPaths: string[]): Promise<{ ok: boolean; error?: string }>;
  delete(bucket: string, key: string): Promise<{ ok: boolean; error?: string }>;
  batchDelete(bucket: string, keys: string[]): Promise<{ ok: boolean; error?: string }>;
  createFolder(bucket: string, key: string): Promise<{ ok: boolean; error?: string }>;
  emptyBucket(bucket: string): Promise<{ ok: boolean; deleted?: number; error?: string }>;
  deleteBucket(bucket: string): Promise<{ ok: boolean; error?: string }>;
  onEmptyProgress(callback: (data: { bucket: string; deleted: number }) => void): () => void;
  getTransferConfig(): Promise<{ ok: boolean; config?: TransferConfig; error?: string }>;
  updateTransferConfig(config: Partial<TransferConfig>): Promise<{ ok: boolean; config?: TransferConfig; error?: string }>;
  previewObject(bucket: string, key: string): Promise<{ ok: boolean; type?: 'image' | 'video'; dataUrl?: string; filePath?: string; error?: string }>;
  presign(bucket: string, key: string, expiresIn: number): Promise<{ ok: boolean; url?: string; error?: string }>;
  rename(bucket: string, oldKey: string, newKey: string): Promise<{ ok: boolean; error?: string }>;
  listVersions(bucket: string, key: string): Promise<{ ok: boolean; versions?: Version[]; error?: string }>;
  restoreVersion(bucket: string, key: string, versionId: string): Promise<{ ok: boolean; error?: string }>;
  deleteVersion(bucket: string, key: string, versionId: string): Promise<{ ok: boolean; error?: string }>;
  getBucketPolicy(bucket: string): Promise<{ ok: boolean; policy?: string; error?: string }>;
  sync(localDir: string, bucket: string, prefix: string): Promise<{ ok: boolean; result?: SyncResult; error?: string }>;
  connList(): Promise<{ ok: boolean; connections?: SavedConnection[]; error?: string }>;
  connSave(connection: SavedConnection, rawSecret?: string): Promise<{ ok: boolean; error?: string }>;
  connDelete(id: string): Promise<{ ok: boolean; error?: string }>;
  localReadDir(dirPath: string): Promise<{ ok: boolean; items?: LocalItem[]; error?: string }>;
}

interface Window {
  s3api: S3Api;
}
