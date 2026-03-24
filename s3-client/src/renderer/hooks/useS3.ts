import { useState, useCallback } from 'react';

const api = window.s3api;

export function useS3() {
  const [connected, setConnected] = useState(false);
  const [buckets, setBuckets] = useState<string[]>([]);
  const [bucketInfoMap, setBucketInfoMap] = useState<Record<string, BucketInfo>>({});
  const [currentBucket, setCurrentBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [items, setItems] = useState<S3Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (config: { auth: AuthConfig; transfer?: TransferConfig }) => {
    setLoading(true);
    setError(null);
    const res = await api.connect(config);
    setLoading(false);
    if (res.ok) {
      setConnected(true);
      setBuckets(res.buckets || []);
      for (const b of res.buckets || []) {
        api.getBucketInfo(b).then(r => {
          if (r.ok && r.info) {
            setBucketInfoMap(prev => ({ ...prev, [b]: r.info! }));
          }
        });
      }
      return { ok: true };
    } else {
      setError(res.error || 'Connection failed');
      return { ok: false, error: res.error };
    }
  }, []);

  const disconnect = useCallback(() => {
    setConnected(false);
    setCurrentBucket(null);
    setBuckets([]);
    setBucketInfoMap({});
    setItems([]);
    setPrefix('');
    setError(null);
  }, []);

  const loadObjects = useCallback(async (bucket: string, pfx: string) => {
    setLoading(true);
    setError(null);
    const res = await api.listObjects(bucket, pfx);
    setLoading(false);
    if (res.ok) {
      setItems(res.items || []);
    } else {
      setError(res.error || 'Failed to list objects');
    }
  }, []);

  const selectBucket = useCallback((b: string) => {
    setCurrentBucket(b);
    setPrefix('');
    loadObjects(b, '');
  }, [loadObjects]);

  const openFolder = useCallback((item: S3Item) => {
    if (!item.isFolder || !currentBucket) return;
    setPrefix(item.key);
    loadObjects(currentBucket, item.key);
  }, [currentBucket, loadObjects]);

  const navigateToPrefix = useCallback((bucket: string, pfx: string) => {
    setCurrentBucket(bucket);
    setPrefix(pfx);
    loadObjects(bucket, pfx);
  }, [loadObjects]);

  const goUp = useCallback(() => {
    if (!currentBucket) return;
    const parts = prefix.replace(/\/$/, '').split('/').filter(Boolean);
    parts.pop();
    const newPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    setPrefix(newPrefix);
    loadObjects(currentBucket, newPrefix);
  }, [currentBucket, prefix, loadObjects]);

  const refresh = useCallback(() => {
    if (currentBucket) loadObjects(currentBucket, prefix);
  }, [currentBucket, prefix, loadObjects]);

  const removeBucket = useCallback((bucket: string) => {
    setBuckets(prev => prev.filter(b => b !== bucket));
    setBucketInfoMap(prev => { const next = { ...prev }; delete next[bucket]; return next; });
    if (currentBucket === bucket) {
      setCurrentBucket(null);
      setItems([]);
      setPrefix('');
    }
  }, [currentBucket]);

  return {
    connected, buckets, bucketInfoMap, currentBucket, prefix, items, loading, error,
    connect, disconnect, selectBucket, openFolder, navigateToPrefix, goUp, refresh,
    setError, removeBucket, setBuckets, setBucketInfoMap,
  };
}
