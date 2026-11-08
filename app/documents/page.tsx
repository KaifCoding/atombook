'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Ban, Copy, Download, Eye, FileOutput, IndianRupee, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Empty, Field, Modal, NumInput, PageHeader, StatusBadge, toast } from '@/components/ui';
import { PdfPreview } from '@/components/PdfPreview';
import { cancelDoc, db, deleteDocIfSafe } from '@/lib/db';
import { useBusiness, useDocs } from '@/lib/hooks';
import { balanceDue, paidAmount, statusFor } from '@/lib/build';
import { fmtDate, fmtMoney, todayStr } from '@/lib/gst';
import { buildPdfBlob, downloadDocPdf } from '@/lib/actions';
import { DOC_TYPES, type Doc, type DocType } from '@/lib/types';

const TYPES = Object.keys(DOC_TYPES) as DocType[];

function List() {
  const sp = useSearchParams();
  const docs = useDocs();
  const business = useBusiness();
  const [type, setType] = useState<DocType | 'all'>((sp.get('type') as DocType) || 'all');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<{ doc: Doc; blob: Blob } | null>(null);
  const [paying, setPaying] = useState<Doc | null>(null);
  const [pay, setPay] = useState({ amount: 0, mode: 'UPI' });

  const list = useMemo(
    () =>
      (docs || []).filter(
        (d) =>
          (type === 'all' || d.type === type) &&
          (status === 'all' || d.status === status) &&
          `${d.number} ${d.party.name} ${d.party.gstin}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [docs, type, status, q],
  );

  const label = (d: Doc) => (DOC_TYPES[d.type].pay === 'open' && d.status === 'draft' ? 'open' : undefined);

  const doPreview = async (d: Doc) => {
    try {
      setPreview({ doc: d, blob: await buildPdfBlob(d) });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const doDownload = async (d: Doc) => {
    try {
      await downloadDocPdf(d);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const doCancel = async (d: Doc) => {
    const msg = DOC_TYPES[d.type].gstReturn
      ? `Cancel ${d.number}? The number stays in your series and is reported as cancelled in GSTR-1.`
      : `Cancel ${d.number}?`;
    if (!window.confirm(msg)) return;
    await cancelDoc(d.id!);
    toast(`${d.number} cancelled`);
  };

  const doDelete = async (d: Doc) => {
    if (!window.confirm(`Delete ${d.number}? This cannot be undone.`)) return;
    const ok = await deleteDocIfSafe(d);
    if (!ok) toast('Issued GST documents cannot be deleted. Cancel them instead.', 'error');
  };

  const recordPayment = async () => {
    if (!paying) return;
    if (!(pay.amount > 0)) return toast('Enter the amount received', 'error');
    const payments = [...paying.payments, { date: todayStr(), amount: pay.amount, mode: pay.mode, ref: '' }];
    await db.docs.update(paying.id!, { payments, status: statusFor(paying.type, paying.totals.total, payments, paying.status), updatedAt: Date.now() });
    setPaying(null);
    toast('Payment recorded');
  };

  const canConvert = (d: Doc) => d.status !== 'cancelled' && ['quotation', 'proforma_invoice', 'delivery_challan', 'tax_invoice'].includes(d.type);

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={`${docs?.length ?? 0} total`}
        actions={
          <Link href="/documents/edit/?type=tax_invoice" className="btn-primary"><Plus size={16} /> New</Link>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
          {(['all', ...TYPES] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${type === t ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
              {t === 'all' ? 'All' : DOC_TYPES[t].label}
            </button>
          ))}
        </div>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          {['all', 'unpaid', 'partial', 'paid', 'draft', 'converted', 'cancelled'].map((s) => <option key={s} value={s}>{s === 'all' ? 'Any status' : s}</option>)}
        </select>
        <input className="input max-w-xs" placeholder="Search number, customer, GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {docs && docs.length === 0 ? (
        <Empty title="No documents yet">
          <Link className="btn-primary" href="/documents/edit/?type=tax_invoice">Create your first document</Link>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="th">Number</th><th className="th">Date</th><th className="th">Customer</th>
                <th className="th text-right">Total</th><th className="th text-right">Balance</th><th className="th">Status</th><th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((d) => {
                const bal = balanceDue(d);
                const showBal = DOC_TYPES[d.type].pay === 'track' && d.status !== 'cancelled';
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="td font-mono text-xs font-semibold">{d.number}<div className="font-sans font-normal text-gray-400">{DOC_TYPES[d.type].label}</div></td>
                    <td className="td whitespace-nowrap">{fmtDate(d.date)}</td>
                    <td className="td">{d.party.name}{d.party.gstin && <div className="font-mono text-[11px] text-gray-400">{d.party.gstin}</div>}</td>
                    <td className={`td text-right ${d.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>₹ {fmtMoney(d.totals.total)}</td>
                    <td className="td text-right">{showBal ? (bal > 0 ? `₹ ${fmtMoney(bal)}` : '–') : ''}</td>
                    <td className="td"><StatusBadge status={d.status} label={label(d)} /></td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="btn-ghost btn-sm mr-1" onClick={() => doPreview(d)} aria-label="Preview"><Eye size={14} /></button>
                      <button className="btn-ghost btn-sm mr-1" onClick={() => doDownload(d)} aria-label="Download PDF"><Download size={14} /></button>
                      <details className="relative inline-block text-left">
                        <summary className="btn-ghost btn-sm cursor-pointer list-none" aria-label="More actions"><MoreVertical size={14} /></summary>
                        <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
                          {d.status !== 'cancelled' && <Link className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50" href={`/documents/edit/?id=${d.id}`}><Pencil size={14} /> Edit</Link>}
                          {showBal && bal > 0 && (
                            <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50" onClick={() => { setPaying(d); setPay({ amount: bal, mode: 'UPI' }); }}><IndianRupee size={14} /> Record payment</button>
                          )}
                          {canConvert(d) && d.type !== 'tax_invoice' && (
                            <Link className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50" href={`/documents/edit/?from=${d.id}&type=${business?.taxScheme === 'regular' ? 'tax_invoice' : business?.taxScheme === 'composition' ? 'bill_of_supply' : 'normal_bill'}`}><FileOutput size={14} /> Convert to invoice</Link>
                          )}
                          {canConvert(d) && d.type === 'tax_invoice' && (
                            <>
                              <Link className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50" href={`/documents/edit/?from=${d.id}&type=credit_note`}><FileOutput size={14} /> Issue credit note</Link>
                              <Link className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50" href={`/documents/edit/?from=${d.id}&type=debit_note`}><FileOutput size={14} /> Issue debit note</Link>
                            </>
                          )}
                          {d.status !== 'cancelled' && DOC_TYPES[d.type].pay === 'track' && d.type !== 'normal_bill' && (
                            <Link className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50" href={`/documents/edit/?from=${d.id}&type=payment_receipt`}><FileOutput size={14} /> Make payment receipt</Link>
                          )}
                          <Link className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50" href={`/documents/edit/?from=${d.id}&type=${d.type}&dup=1`}><Copy size={14} /> Duplicate</Link>
                          {d.status !== 'cancelled' && (
                            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50" onClick={() => doCancel(d)}><Ban size={14} /> Cancel</button>
                          )}
                          {!DOC_TYPES[d.type].gstReturn && (
                            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50" onClick={() => doDelete(d)}><Trash2 size={14} /> Delete</button>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
              {!list.length && <tr><td className="td text-center text-gray-400" colSpan={7}>Nothing matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <Modal title={preview.doc.number} wide onClose={() => setPreview(null)}>
          <div className="mb-3 flex justify-end"><button className="btn-primary btn-sm" onClick={() => doDownload(preview.doc)}><Download size={14} /> Download PDF</button></div>
          <PdfPreview blob={preview.blob} />
        </Modal>
      )}

      {paying && (
        <Modal title={`Payment for ${paying.number}`} onClose={() => setPaying(null)}>
          <p className="mb-3 text-sm text-gray-600">Total ₹ {fmtMoney(paying.totals.total)} · received ₹ {fmtMoney(paidAmount(paying))} · balance ₹ {fmtMoney(balanceDue(paying))}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount received (₹)"><NumInput value={pay.amount} onChange={(n) => setPay({ ...pay, amount: n })} /></Field>
            <Field label="Mode"><select className="input" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>{['UPI', 'Cash', 'Card', 'Bank', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          </div>
          <div className="mt-5 flex justify-end gap-2"><button className="btn-ghost" onClick={() => setPaying(null)}>Cancel</button><button className="btn-primary" onClick={recordPayment}>Save payment</button></div>
        </Modal>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
      <List />
    </Suspense>
  );
}
