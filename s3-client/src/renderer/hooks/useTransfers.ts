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
    setTransfers(prev => {
      if (prev.some(t => t.id === id)) return prev;
      return [...prev, { ...item, id }];
    });
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
