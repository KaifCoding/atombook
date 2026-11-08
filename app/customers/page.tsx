'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Empty, Field, Modal, PageHeader, StateSelect, toast } from '@/components/ui';
import { db } from '@/lib/db';
import { useCustomers } from '@/lib/hooks';
import { isValidGstin, stateFromGstin } from '@/lib/gst';
import { stateName } from '@/lib/states';
import type { Customer } from '@/lib/types';

const blank = (): Customer => ({ name: '', gstin: '', address: '', stateCode: '', phone: '', email: '', createdAt: Date.now() });

export default function CustomersPage() {
  const customers = useCustomers();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);

  const list = (customers || []).filter((c) => `${c.name} ${c.gstin} ${c.phone}`.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!editing) return;
    const c = { ...editing, name: editing.name.trim(), gstin: editing.gstin.trim().toUpperCase() };
    if (!c.name) return toast('Enter the customer name', 'error');
    if (c.gstin && !isValidGstin(c.gstin)) return toast('GSTIN is not valid', 'error');
    if (c.id != null) await db.customers.put(c);
    else await db.customers.add(c);
    setEditing(null);
    toast('Customer saved');
  };

  const remove = async (c: Customer) => {
    if (!window.confirm(`Delete ${c.name}? Existing documents keep their copy of the details.`)) return;
    await db.customers.delete(c.id!);
  };

  const gstinBad = !!editing?.gstin && !isValidGstin(editing.gstin);

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers?.length ?? 0} saved`}
        actions={
          <button className="btn-primary" onClick={() => setEditing(blank())}>
            <Plus size={16} /> Add customer
          </button>
        }
      />
      <input className="input mb-3 max-w-sm" placeholder="Search name, GSTIN, phone" value={q} onChange={(e) => setQ(e.target.value)} />

      {customers && customers.length === 0 ? (
        <Empty title="No customers yet">
          <button className="btn-primary" onClick={() => setEditing(blank())}>Add your first customer</button>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full">
            <thead className="border-b bg-gray-50">
              <tr><th className="th">Name</th><th className="th">GSTIN</th><th className="th">State</th><th className="th">Phone</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="td font-medium">{c.name}<div className="text-xs font-normal text-gray-400">{c.address}</div></td>
                  <td className="td font-mono text-xs">{c.gstin || <span className="text-gray-400">Unregistered</span>}</td>
                  <td className="td">{stateName(c.stateCode)}</td>
                  <td className="td">{c.phone}</td>
                  <td className="td whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm mr-1" onClick={() => setEditing(c)}><Pencil size={13} /></button>
                    <button className="btn-danger btn-sm" onClick={() => remove(c)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal title={editing.id ? 'Edit customer' : 'Add customer'} onClose={() => setEditing(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name *" className="md:col-span-2"><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></Field>
            <Field label="GSTIN (leave empty if unregistered)" error={gstinBad ? 'Invalid GSTIN' : undefined}>
              <input
                className="input uppercase"
                maxLength={15}
                value={editing.gstin}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
                  setEditing({ ...editing, gstin: v, stateCode: isValidGstin(v) ? stateFromGstin(v) : editing.stateCode });
                }}
              />
            </Field>
            <Field label="State"><StateSelect value={editing.stateCode} onChange={(v) => setEditing({ ...editing, stateCode: v })} /></Field>
            <Field label="Address" className="md:col-span-2"><textarea className="input" rows={2} value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" inputMode="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
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
