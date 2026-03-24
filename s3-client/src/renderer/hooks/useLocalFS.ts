import { useState, useCallback } from 'react';

const api = window.s3api;

export function useLocalFS() {
  const [currentDir, setCurrentDir] = useState<string>('/Users');
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    const res = await api.localReadDir(dirPath);
    setLoading(false);
    if (res.ok) {
      const sorted = (res.items || []).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setItems(sorted);
      setCurrentDir(dirPath);
    } else {
      setError(res.error || 'Failed to read directory');
    }
  }, []);

  const navigateTo = useCallback((dirPath: string) => {
    readDir(dirPath);
  }, [readDir]);

  const goUp = useCallback(() => {
    const parts = currentDir.replace(/\/$/, '').split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length > 0 ? '/' + parts.join('/') : '/';
    readDir(parent);
  }, [currentDir, readDir]);

  return { currentDir, items, loading, error, navigateTo, goUp, refresh: () => readDir(currentDir) };
}
