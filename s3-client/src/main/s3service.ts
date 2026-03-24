import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetBucketLocationCommand,
  CopyObjectCommand,
  ListObjectVersionsCommand,
  GetBucketVersioningCommand,
  GetBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromIni } from '@aws-sdk/credential-providers';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';

export interface S3Item {
  key: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  isFolder: boolean;
  storageClass?: string;
}

export interface TransferConfig {
  multipartThresholdMB: number;
  partSizeMB: number;
  concurrency: number;
  timeoutSeconds: number;
}

const DEFAULT_TRANSFER_CONFIG: TransferConfig = {
  multipartThresholdMB: 64,
  partSizeMB: 8,
  concurrency: 4,
  timeoutSeconds: 300,
};

export interface AuthConfig {
  mode: 'profile' | 'keys';
  profile?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region: string;
}

export interface Version {
  versionId: string;
  size: number;
  lastModified: string;
  isLatest: boolean;
}

export interface SyncResult {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export class S3Service {
  private client: S3Client;
  private transferConfig: TransferConfig;

  constructor(auth: AuthConfig, transferConfig?: Partial<TransferConfig>) {
    this.transferConfig = { ...DEFAULT_TRANSFER_CONFIG, ...transferConfig };

    const credentials = auth.mode === 'profile'
      ? fromIni({ profile: auth.profile || 'default' })
      : { accessKeyId: auth.accessKeyId!, secretAccessKey: auth.secretAccessKey! };

    this.client = new S3Client({
      region: auth.region,
      credentials,
      followRegionRedirects: true,
      requestHandler: {
        requestTimeout: this.transferConfig.timeoutSeconds * 1000,
        httpsAgent: undefined as any,
      } as any,
    });
  }

  updateTransferConfig(config: Partial<TransferConfig>) {
    this.transferConfig = { ...this.transferConfig, ...config };
  }

  getTransferConfig(): TransferConfig {
    return { ...this.transferConfig };
  }

  async listBuckets(): Promise<string[]> {
    const res = await this.client.send(new ListBucketsCommand({}));
    return (res.Buckets || []).map((b) => b.Name!).filter(Boolean);
  }

  async getBucketInfo(bucket: string): Promise<{ region: string }> {
    let region = 'us-east-1';
    try {
      const loc = await this.client.send(new GetBucketLocationCommand({ Bucket: bucket }));
      region = loc.LocationConstraint || 'us-east-1';
    } catch { /* fallback */ }
    return { region };
  }

  async listObjects(bucket: string, prefix: string): Promise<S3Item[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, Delimiter: '/' })
    );
    const items: S3Item[] = [];
    for (const p of res.CommonPrefixes || []) {
      if (p.Prefix) {
        const name = p.Prefix.replace(prefix, '').replace(/\/$/, '');
        items.push({ key: p.Prefix, name, size: null, lastModified: null, isFolder: true });
      }
    }
    for (const obj of res.Contents || []) {
      if (!obj.Key || obj.Key === prefix) continue;
      const name = obj.Key.replace(prefix, '');
      items.push({
        key: obj.Key,
        name,
        size: obj.Size ?? null,
        lastModified: obj.LastModified?.toISOString() ?? null,
        isFolder: false,
        storageClass: obj.StorageClass,
      });
    }
    return items;
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as Readable;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  async downloadFile(bucket: string, key: string, destPath: string): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const stream = res.Body as Readable;
    const ws = fs.createWriteStream(destPath);
    await new Promise<void>((resolve, reject) => {
      stream.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });
  }

  async listAllObjects(bucket: string, prefix: string): Promise<{ key: string; size: number }[]> {
    const allObjects: { key: string; size: number }[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));
      for (const obj of res.Contents || []) {
        if (obj.Key && !obj.Key.endsWith('/')) {
          allObjects.push({ key: obj.Key, size: obj.Size ?? 0 });
        }
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return allObjects;
  }

  async downloadToDir(bucket: string, key: string, basePrefix: string, destDir: string): Promise<void> {
    const relativePath = key.slice(basePrefix.length);
    const fullPath = path.join(destDir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await this.downloadFile(bucket, key, fullPath);
  }

  async batchDownload(
    bucket: string,
    items: { key: string; isFolder: boolean }[],
    currentPrefix: string,
    destDir: string,
    onProgress?: (completed: number, total: number, currentFile: string) => void
  ): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    const fileKeys: string[] = [];
    for (const item of items) {
      if (item.isFolder) {
        const children = await this.listAllObjects(bucket, item.key);
        fileKeys.push(...children.map(c => c.key));
      } else {
        fileKeys.push(item.key);
      }
    }

    const total = fileKeys.length;
    let completed = 0;
    let failed = 0;
    const errors: string[] = [];
    const concurrency = this.transferConfig.concurrency;

    for (let i = 0; i < fileKeys.length; i += concurrency) {
      const batch = fileKeys.slice(i, i + concurrency).map(async (key) => {
        try {
          await this.downloadToDir(bucket, key, currentPrefix, destDir);
          completed++;
        } catch (err: any) {
          failed++;
          errors.push(`${key}: ${err.message}`);
        }
        onProgress?.(completed + failed, total, key.split('/').pop() || key);
      });
      await Promise.all(batch);
    }

    return { succeeded: completed, failed, errors };
  }

  async uploadFile(bucket: string, key: string, filePath: string): Promise<void> {
    const stat = fs.statSync(filePath);
    const thresholdBytes = this.transferConfig.multipartThresholdMB * 1024 * 1024;

    if (stat.size <= thresholdBytes) {
      const body = fs.readFileSync(filePath);
      await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    } else {
      await this.multipartUpload(bucket, key, filePath, stat.size);
    }
  }

  private async multipartUpload(bucket: string, key: string, filePath: string, fileSize: number): Promise<void> {
    const partSize = this.transferConfig.partSizeMB * 1024 * 1024;
    const concurrency = this.transferConfig.concurrency;

    const { UploadId } = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key })
    );
    if (!UploadId) throw new Error('Failed to create multipart upload');

    const totalParts = Math.ceil(fileSize / partSize);
    const parts: { ETag: string; PartNumber: number }[] = [];
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

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async batchDeleteObjects(bucket: string, keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000).map(k => ({ Key: k }));
      await this.client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      }));
    }
  }

  async createFolder(bucket: string, key: string): Promise<void> {
    const folderKey = key.endsWith('/') ? key : key + '/';
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: folderKey, Body: '' }));
  }

  async emptyBucket(bucket: string, onProgress?: (deleted: number) => void): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const list = await this.client.send(new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }));

      const objects = (list.Contents || []).filter(o => o.Key).map(o => ({ Key: o.Key! }));
      if (objects.length > 0) {
        await this.client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true },
        }));
        deleted += objects.length;
        onProgress?.(deleted);
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  }

  async deleteBucket(bucket: string): Promise<void> {
    await this.client.send(new DeleteBucketCommand({ Bucket: bucket }));
  }

  async getPresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async renameObject(bucket: string, oldKey: string, newKey: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${oldKey}`,
      Key: newKey,
    }));
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey }));
  }

  async listObjectVersions(bucket: string, key: string): Promise<Version[]> {
    const res = await this.client.send(new ListObjectVersionsCommand({
      Bucket: bucket,
      Prefix: key,
    }));
    return (res.Versions || [])
      .filter(v => v.Key === key)
      .map(v => ({
        versionId: v.VersionId!,
        size: v.Size ?? 0,
        lastModified: v.LastModified?.toISOString() ?? '',
        isLatest: v.IsLatest ?? false,
      }));
  }

  async restoreVersion(bucket: string, key: string, versionId: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${key}?versionId=${versionId}`,
      Key: key,
    }));
  }

  async deleteVersion(bucket: string, key: string, versionId: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: versionId,
    }));
  }

  async getBucketPolicy(bucket: string): Promise<string> {
    const res = await this.client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    return res.Policy || '{}';
  }

  async syncLocalToS3(
    localDir: string,
    bucket: string,
    prefix: string,
    opts: { concurrency: number; multipartThresholdMB: number },
    onProgress?: (item: string) => void
  ): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, skipped: 0, failed: 0, errors: [] };

    // Collect local files recursively
    const localFiles: { absPath: string; relPath: string }[] = [];
    const walk = (dir: string, base: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.join(base, entry.name);
        if (entry.isDirectory()) {
          walk(full, rel);
        } else {
          localFiles.push({ absPath: full, relPath: rel });
        }
      }
    };
    walk(localDir, '');

    // Get existing S3 objects under prefix
    const s3Objects = await this.listAllObjects(bucket, prefix);
    const s3Map = new Map(s3Objects.map(o => [o.key, o.size]));

    // Determine files to upload
    const thresholdBytes = opts.multipartThresholdMB * 1024 * 1024;
    const toUpload: { absPath: string; key: string }[] = [];

    for (const { absPath, relPath } of localFiles) {
      const key = prefix ? prefix + relPath.replace(/\\/g, '/') : relPath.replace(/\\/g, '/');
      const localStat = fs.statSync(absPath);
      const localSize = localStat.size;
      const s3Size = s3Map.get(key);

      if (s3Size === undefined) {
        toUpload.push({ absPath, key });
      } else if (s3Size !== localSize) {
        toUpload.push({ absPath, key });
      } else if (localSize <= thresholdBytes) {
        // Compare MD5 vs ETag for small files
        const localMd5 = crypto.createHash('md5').update(fs.readFileSync(absPath)).digest('hex');
        const s3ETag = (await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).then(
          r => r.ETag?.replace(/"/g, '') ?? ''
        ).catch(() => ''));
        if (localMd5 !== s3ETag) {
          toUpload.push({ absPath, key });
        } else {
          result.skipped++;
        }
      } else {
        // Large file, size matches — assume unchanged
        result.skipped++;
      }
    }

    // Upload with concurrency
    for (let i = 0; i < toUpload.length; i += opts.concurrency) {
      const batch = toUpload.slice(i, i + opts.concurrency).map(async ({ absPath, key }) => {
        try {
          onProgress?.(path.basename(absPath));
          await this.uploadFile(bucket, key, absPath);
          result.uploaded++;
        } catch (err: any) {
          result.failed++;
          result.errors.push(`${key}: ${err.message}`);
        }
      });
      await Promise.all(batch);
    }

    return result;
  }
}
