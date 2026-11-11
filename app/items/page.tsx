'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Empty, Field, Modal, PageHeader, toast } from '@/components/ui';
import { db, deleteItem } from "@/lib/db";
import { useItems } from '@/lib/hooks';
import { fmtMoney, GST_RATES, UNITS } from '@/lib/gst';
import type { Item } from '@/lib/types';

const blank = (): Item => ({ name: '', description: '', kind: 'goods', hsn: '', unit: 'NOS', rate: 0, gstRate: 18, taxInclusive: false, createdAt: Date.now() });

export default function ItemsPage() {
  const items = useItems();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);

  const list = (items || []).filter((i) => `${i.name} ${i.hsn}`.toLowerCase().includes(q.toLowerCase()));

  const hsnWarning = (it: Item): string | undefined => {
    if (!it.hsn) return undefined;
    if (!/^\d+$/.test(it.hsn)) return 'Use digits only';
    if (![4, 6, 8].includes(it.hsn.length)) return 'HSN/SAC is usually 4, 6 or 8 digits';
    if (it.kind === 'service' && !it.hsn.startsWith('99')) return 'Service codes (SAC) start with 99';
    return undefined;
  };

  const save = async () => {
    if (!editing) return;
    const it = { ...editing, name: editing.name.trim(), hsn: editing.hsn.trim() };
    if (!it.name) return toast('Enter the item name', 'error');
    if (!(it.rate >= 0)) return toast('Rate cannot be negative', 'error');
    if (it.id != null) await db.items.put(it);
    else await db.items.add(it);
    setEditing(null);
    toast('Item saved');
  };

  const remove = async (it: Item) => {
    if (!window.confirm(`Delete ${it.name}? Existing documents keep their copy of the item.`)) return;
    await deleteItem(it.id!);
  };

  return (
    <div>
      <PageHeader
        title="Products & Services"
        subtitle={`${items?.length ?? 0} saved`}
        actions={<button className="btn-primary" onClick={() => setEditing(blank())}><Plus size={16} /> Add item</button>}
      />
      <input className="input mb-3 max-w-sm" placeholder="Search name or HSN/SAC" value={q} onChange={(e) => setQ(e.target.value)} />

      {items && items.length === 0 ? (
        <Empty title="No products or services yet">
          <button className="btn-primary" onClick={() => setEditing(blank())}>Add your first item</button>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full">
            <thead className="border-b bg-gray-50">
              <tr><th className="th">Name</th><th className="th">Type</th><th className="th">HSN/SAC</th><th className="th">Unit</th><th className="th text-right">Rate</th><th className="th text-right">GST</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((i) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="td font-medium">{i.name}{i.description && <div className="text-xs font-normal text-gray-400">{i.description}</div>}</td>
                  <td className="td capitalize">{i.kind}</td>
                  <td className="td font-mono text-xs">{i.hsn}</td>
                  <td className="td">{i.unit}</td>
                  <td className="td text-right">₹ {fmtMoney(i.rate)}{i.taxInclusive && <span className="ml-1 text-[10px] text-gray-400">incl.</span>}</td>
                  <td className="td text-right">{i.gstRate}%</td>
                  <td className="td whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm mr-1" onClick={() => setEditing(i)}><Pencil size={13} /></button>
                    <button className="btn-danger btn-sm" onClick={() => remove(i)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit item' : 'Add item'} onClose={() => setEditing(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name *" className="md:col-span-2"><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></Field>
            <Field label="Type">
              <select className="input" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Item['kind'], unit: e.target.value === 'service' ? 'OTH' : editing.unit })}>
                <option value="goods">Goods (HSN)</option>
                <option value="service">Service (SAC)</option>
              </select>
            </Field>
            <Field label={editing.kind === 'service' ? 'SAC code' : 'HSN code'} error={hsnWarning(editing)}>
              <input className="input" inputMode="numeric" value={editing.hsn} onChange={(e) => setEditing({ ...editing, hsn: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="Unit">
              <select className="input" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="GST rate">
              <select className="input" value={editing.gstRate} onChange={(e) => setEditing({ ...editing, gstRate: Number(e.target.value) })}>
                {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
            </Field>
            <Field label="Rate (₹)"><input className="input" type="number" min={0} step="0.01" value={editing.rate} onChange={(e) => setEditing({ ...editing, rate: Number(e.target.value) })} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={editing.taxInclusive} onChange={(e) => setEditing({ ...editing, taxInclusive: e.target.checked })} /> Rate includes GST
            </label>
            <Field label="Description" className="md:col-span-2"><input className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
