import React, { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const menuWidth = 200;
  const menuHeight = items.length * 34 + 8;
  const left = x + menuWidth > window.innerWidth ? x - menuWidth : x;
  const top = y + menuHeight > window.innerHeight ? y - menuHeight : y;

  return (
    <div ref={ref} style={{ ...s.menu, left, top }}>
      {items.map((item, i) => (
        item.label === '---' ? (
          <div key={i} style={s.divider} />
        ) : (
          <button key={i}
            style={{ ...s.item, ...(item.danger ? s.danger : {}), ...(item.disabled ? s.disabled : {}) }}
            onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }}
            disabled={item.disabled}>
            {item.icon && <span style={{ marginRight: 8, opacity: 0.8 }}>{item.icon}</span>}
            {item.label}
          </button>
        )
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  menu: {
    position: 'fixed', zIndex: 9999, background: 'var(--surface)',
    border: '1px solid var(--border)', borderRadius: 8,
    padding: '4px 0', minWidth: 180,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  item: {
    display: 'flex', alignItems: 'center', width: '100%',
    padding: '6px 14px', fontSize: 13, color: 'var(--text)',
    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const,
  },
  danger: { color: 'var(--danger)' },
  disabled: { opacity: 0.4, cursor: 'default' },
  divider: { height: 1, background: 'var(--border)', margin: '3px 0' },
};
