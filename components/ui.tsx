'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { STATES } from '@/lib/states';
import type { DocStatus } from '@/lib/types';

/* ---------------- toast ---------------- */

export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  window.dispatchEvent(new CustomEvent('atombook-toast', { detail: { message, kind } }));
}

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; message: string; kind: string }[]>([]);
  useEffect(() => {
    let n = 0;
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const id = ++n;
      setItems((s) => [...s, { id, ...d }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4500);
    };
    window.addEventListener('atombook-toast', h);
    return () => window.removeEventListener('atombook-toast', h);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${t.kind === 'error' ? 'bg-red-600' : 'bg-gray-900'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ---------------- layout bits ---------------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900 md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-gray-400">{hint}</span> : null}
    </label>
  );
}

export function StateSelect({ value, onChange, placeholder = 'Select state' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.code} – {s.name}
        </option>
      ))}
    </select>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl md:rounded-2xl ${wide ? 'md:max-w-4xl' : 'md:max-w-xl'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="rounded p-1 hover:bg-gray-100" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<DocStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  unpaid: 'bg-amber-100 text-amber-800',
  partial: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-700',
  converted: 'bg-purple-100 text-purple-800',
};

export function StatusBadge({ status, label }: { status: DocStatus; label?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}>{label || status}</span>;
}

/** Number input that lets the user clear the field and type decimals freely. */
export function NumInput({
  value,
  onChange,
  className = 'input',
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={className}
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        if (/^\d*\.?\d*$/.test(t)) {
          setText(t);
          onChange(t === '' || t === '.' ? 0 : Number(t));
        }
      }}
    />
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <div className="text-sm font-medium text-gray-700">{title}</div>
      {children && <div className="mt-3 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

/* ---------------- image upload (logo, signature, seal, QR) ---------------- */

/** Reads an image file and downsizes it so the database and PDFs stay small. Keeps transparency (PNG). */
export function fileToDataUrl(file: File, maxSize = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a valid image'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function ImageUpload({
  label,
  value,
  onChange,
  hint,
  maxSize = 600,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  maxSize?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-28 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50 [background-image:linear-gradient(45deg,#eee_25%,transparent_25%,transparent_75%,#eee_75%),linear-gradient(45deg,#eee_25%,transparent_25%,transparent_75%,#eee_75%)] [background-position:0_0,6px_6px] [background-size:12px_12px]">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
          ) : (
            <ImagePlus className="text-gray-400" size={22} />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <button type="button" className="btn-ghost btn-sm" onClick={() => ref.current?.click()}>
            {value ? 'Change' : 'Upload'}
          </button>
          {value && (
            <button type="button" className="btn-danger btn-sm" onClick={() => onChange('')}>
              <Trash2 size={13} /> Remove
            </button>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              onChange(await fileToDataUrl(f, maxSize));
            } catch (err) {
              toast((err as Error).message, 'error');
            }
          }}
        />
      </div>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
