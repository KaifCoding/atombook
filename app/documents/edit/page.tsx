'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Download, Eye, Plus, Save, Trash2 } from 'lucide-react';
import { Field, Modal, NumInput, PageHeader, StateSelect, toast } from '@/components/ui';
import { PdfPreview } from '@/components/PdfPreview';
import { createDoc, db, peekNumber, updateDoc } from '@/lib/db';
import { useBusiness, useCustomers, useItems } from '@/lib/hooks';
import { balanceDue, buildDocPayload, statusFor, type DocInput } from '@/lib/build';
import { calcDocument, fmtMoney, fyCode, GST_RATES, isValidGstin, stateFromGstin, todayStr, UNITS } from '@/lib/gst';
import { buildPdfBlob, downloadDocPdf } from '@/lib/actions';
import { DOC_TYPES, DOC_TYPE_LIST, type Business, type Doc, type DocType, type LineItem } from '@/lib/types';

const addDays = (d: string, n: number) => {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return todayStr(dt);
};

const blankLine = (): LineItem => ({ name: '', description: '', hsn: '', unit: 'NOS', qty: 1, rate: 0, discountPct: 0, gstRate: 18, taxInclusive: false });

function allowedTypes(b: Business): DocType[] {
  return DOC_TYPE_LIST.filter((t) => DOC_TYPES[t].schemes.includes(b.taxScheme));
}

function newForm(type: DocType, b: Business): DocInput {
  const date = todayStr();
  return {
    type,
    date,
    dueDate: addDays(date, 15),
    party: { name: '', gstin: '', address: '', stateCode: '', phone: '', email: '' },
    placeOfSupply: b.stateCode,
    lines: [blankLine()],
    extras: [],
    reverseCharge: false,
    notes: b.defaultNotes,
    terms: b.defaultTerms,
    status: 'unpaid',
    payments: [],
    roundOffEnabled: true,
    showTaxInQuotation: b.taxScheme === 'regular',
  };
}

function formFromDoc(d: Doc): DocInput {
  return {
    type: d.type, date: d.date, dueDate: d.dueDate, party: d.party, placeOfSupply: d.placeOfSupply, lines: d.lines, extras: d.extras,
    reverseCharge: d.reverseCharge, notes: d.notes, terms: d.terms, status: d.status, payments: d.payments, roundOffEnabled: d.roundOffEnabled,
    showTaxInQuotation: d.showTaxInQuotation, convertedFrom: d.convertedFrom, refNumber: d.refNumber, refDate: d.refDate, reason: d.reason,
  };
}

function Editor() {
  const sp = useSearchParams();
  const router = useRouter();
  const business = useBusiness();
  const customers = useCustomers();
  const items = useItems();

  const [form, setForm] = useState<DocInput | null>(null);
  const [existing, setExisting] = useState<Doc | null>(null);
  const [numberPreview, setNumberPreview] = useState('');
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [receive, setReceive] = useState({ amount: 0, mode: 'UPI' });
  const [preview, setPreview] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  const idParam = sp.get('id');
  const fromParam = sp.get('from');
  const dupParam = sp.get('dup') === '1';
  const typeParam = (sp.get('type') as DocType | null) || 'tax_invoice';

  /* ---- initialise once the business is loaded ---- */
  useEffect(() => {
    if (!business || form) return;
    (async () => {
      if (idParam) {
        const d = await db.docs.get(Number(idParam));
        if (d) {
          setExisting(d);
          setForm(formFromDoc(d));
          setNumberPreview(d.number);
        }
        return;
      }
      const allowed = allowedTypes(business);
      const wanted = allowed.includes(typeParam) ? typeParam : allowed[0];
      const f = newForm(wanted, business);
      if (fromParam) {
        const src = await db.docs.get(Number(fromParam));
        if (src) {
          f.party = src.party;
          f.placeOfSupply = src.placeOfSupply;
          f.lines = src.lines;
          f.extras = src.extras;
          f.reverseCharge = src.reverseCharge;
          f.notes = src.notes;
          f.convertedFrom = dupParam ? undefined : src.id;
          if (DOC_TYPES[wanted].needsRef || wanted === 'payment_receipt') {
            f.refNumber = src.number;
            f.refDate = src.date;
          }
          if (wanted === 'payment_receipt') {
            f.lines = [{ ...blankLine(), name: `Payment received against ${src.number}`, rate: balanceDue(src), gstRate: 0 }];
            f.extras = [];
            f.reverseCharge = false;
          }
        }
      }
      setForm(f);
    })();
  }, [business, form, idParam, fromParam, typeParam, dupParam]);

  /* ---- number preview for new docs ---- */
  useEffect(() => {
    if (!business || !form || existing) return;
    peekNumber(form.type, form.date, business).then((n) => setNumberPreview(n.number));
  }, [business, form?.type, form?.date, existing]); // eslint-disable-line react-hooks/exhaustive-deps

  const calc = useMemo(() => {
    if (!business || !form) return null;
    return calcDocument({
      type: form.type,
      lines: form.lines,
      extras: form.extras,
      businessState: business.stateCode,
      placeOfSupply: form.placeOfSupply,
      roundOff: form.roundOffEnabled,
      showTaxInQuotation: form.showTaxInQuotation && business.taxScheme === 'regular',
    });
  }, [business, form]);

  if (!business || !form || !calc) return <div className="text-sm text-gray-500">Loading…</div>;

  const set = <K extends keyof DocInput>(k: K, v: DocInput[K]) => setForm((p) => (p ? { ...p, [k]: v } : p));
  const setParty = (k: keyof DocInput['party'], v: string) => setForm((p) => (p ? { ...p, party: { ...p.party, [k]: v } } : p));
  const setLine = (i: number, patch: Partial<LineItem>) => setForm((p) => (p ? { ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } : p));

  const meta = DOC_TYPES[form.type];
  const taxed = meta.hasTax && (form.type !== 'quotation' || (form.showTaxInQuotation && business.taxScheme === 'regular'));
  const setupIncomplete = !business.name || !business.stateCode;
  const types = allowedTypes(business);
  const partyGstinBad = !!form.party.gstin && !isValidGstin(form.party.gstin);
  const totalPaid = form.payments.reduce((a, p) => a + p.amount, 0);

  const pickCustomer = (id: string) => {
    const c = customers?.find((x) => String(x.id) === id);
    if (!c) return;
    setForm((p) =>
      p ? { ...p, party: { customerId: c.id, name: c.name, gstin: c.gstin, address: c.address, stateCode: c.stateCode, phone: c.phone, email: c.email }, placeOfSupply: c.stateCode || business.stateCode } : p,
    );
  };

  const addCatalogItem = (id: string) => {
    const it = items?.find((x) => String(x.id) === id);
    if (!it) return;
    const line: LineItem = { itemId: it.id, name: it.name, description: it.description, hsn: it.hsn, unit: it.unit, qty: 1, rate: it.rate, discountPct: 0, gstRate: it.gstRate, taxInclusive: it.taxInclusive };
    setForm((p) => {
      if (!p) return p;
      const onlyBlank = p.lines.length === 1 && !p.lines[0].name && p.lines[0].rate === 0;
      return { ...p, lines: onlyBlank ? [line] : [...p.lines, line] };
    });
  };

  const validate = (): string | null => {
    if (setupIncomplete) return 'Complete Business Setup first (name and state).';
    if (!types.includes(form.type)) return `${meta.label} is not available for your GST scheme.`;
    if (form.type === 'tax_invoice' && !business.gstin) return 'Add your GSTIN in Business Setup to issue tax invoices.';
    if (partyGstinBad) return 'Customer GSTIN is not valid.';
    if (taxed && !form.placeOfSupply) return 'Select the place of supply.';
    const good = form.lines.filter((l) => l.name.trim());
    if (!good.length) return 'Add at least one item.';
    if (good.some((l) => !(l.qty > 0))) return 'Quantity must be more than zero.';
    if (meta.needsRef && !form.refNumber?.trim()) return `Enter the original invoice number this ${meta.label.toLowerCase()} is against.`;
    if (calc.totals.total < 0) return 'Total cannot be negative.';
    return null;
  };

  const persist = async (): Promise<Doc | null> => {
    const err = validate();
    if (err) {
      toast(err, 'error');
      return null;
    }
    const payments = receive.amount > 0 ? [...form.payments, { date: todayStr(), amount: receive.amount, mode: receive.mode, ref: '' }] : form.payments;
    const input: DocInput = {
      ...form,
      lines: form.lines.filter((l) => l.name.trim()),
      extras: form.extras.filter((e) => e.amount > 0),
      party: { ...form.party, name: form.party.name.trim() || 'Walk-in Customer', gstin: form.party.gstin.trim().toUpperCase() },
      payments,
      status: 'unpaid',
    };
    // status depends on totals, which come from the payload
    const draft = buildDocPayload(input, business);
    draft.status = statusFor(form.type, draft.totals.total, payments, existing?.status);
    draft.payments = payments;

    let saved: Doc;
    if (existing) {
      saved = { ...existing, ...draft, id: existing.id, number: existing.number, seq: existing.seq, fy: existing.fy, createdAt: existing.createdAt };
      await updateDoc(saved);
    } else {
      saved = await createDoc(draft, business);
      if (input.type === 'payment_receipt' && input.convertedFrom) {
        const src = await db.docs.get(input.convertedFrom);
        if (src?.id != null && saved.totals.total > 0) {
          const pays = [...src.payments, { date: saved.date, amount: saved.totals.total, mode: 'Receipt', ref: saved.number }];
          await db.docs.update(src.id, { payments: pays, status: statusFor(src.type, src.totals.total, pays, src.status), updatedAt: Date.now() });
        }
      }
      if (input.convertedFrom && !DOC_TYPES[input.type].needsRef && input.type !== 'payment_receipt') await db.docs.update(input.convertedFrom, { status: 'converted' });
    }
    if (saveCustomer && !input.party.customerId && input.party.name !== 'Walk-in Customer') {
      const dup = await db.customers.where('name').equals(input.party.name).first();
      if (!dup) await db.customers.add({ ...input.party, createdAt: Date.now() });
    }
    setReceive({ amount: 0, mode: receive.mode });
    return saved;
  };

  const onSave = async () => {
    setBusy(true);
    try {
      const d = await persist();
      if (d) {
        toast(`${meta.label} ${d.number} saved`);
        router.push('/documents/');
      }
    } finally {
      setBusy(false);
    }
  };

  const onSavePdf = async () => {
    setBusy(true);
    try {
      const d = await persist();
      if (d) {
        await downloadDocPdf(d);
        toast(`${d.number} saved and PDF created`);
        router.push('/documents/');
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onPreview = async () => {
    const err = validate();
    if (err) return toast(err, 'error');
    setBusy(true);
    try {
      const payments = receive.amount > 0 ? [...form.payments, { date: todayStr(), amount: receive.amount, mode: receive.mode, ref: '' }] : form.payments;
      const payload = buildDocPayload({ ...form, lines: form.lines.filter((l) => l.name.trim()), extras: form.extras.filter((e) => e.amount > 0), payments, party: { ...form.party, name: form.party.name || 'Walk-in Customer' } }, business);
      const doc: Doc = { ...payload, id: existing?.id, seq: existing?.seq ?? 0, fy: existing?.fy ?? fyCode(form.date), number: numberPreview || 'DRAFT' };
      setPreview(await buildPdfBlob(doc));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const t = calc.totals;
  const lineGross = calc.lineCalcs.reduce((a, c) => a + c.gross, 0);
  const lineDisc = calc.lineCalcs.reduce((a, c) => a + c.discount, 0);

  return (
    <div>
      <PageHeader
        title={existing ? `Edit ${meta.label}` : `New ${meta.label}`}
        subtitle={numberPreview ? `Number: ${numberPreview}${existing ? '' : ' (assigned on save)'}` : undefined}
        actions={
          <>
            <button className="btn-ghost" onClick={onPreview} disabled={busy}><Eye size={16} /> Preview</button>
            <button className="btn-ghost" onClick={onSave} disabled={busy}><Save size={16} /> Save</button>
            <button className="btn-primary" onClick={onSavePdf} disabled={busy}><Download size={16} /> Save &amp; PDF</button>
          </>
        }
      />

      {setupIncomplete && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Your business details are incomplete. <Link href="/settings/" className="font-semibold underline">Open Business Setup</Link> before creating documents.
        </div>
      )}
      {business.taxScheme !== 'regular' && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {business.taxScheme === 'composition'
            ? 'Composition scheme: you cannot charge GST, so Tax Invoice and Credit Note are hidden. Use Bill of Supply.'
            : 'Not registered under GST: you cannot charge GST. Use Bill or Quotation.'}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {/* type & dates */}
          <section className="card">
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Document type">
                <select className="input" value={form.type} disabled={!!existing} onChange={(e) => set('type', e.target.value as DocType)}>
                  {types.map((t) => <option key={t} value={t}>{DOC_TYPES[t].label}</option>)}
                </select>
              </Field>
              <Field label="Date"><input className="input" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
              {!!meta.dueLabel && (
                <Field label={meta.dueLabel}><input className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
              )}
              {meta.hasTax && (
                <Field label="Place of supply"><StateSelect value={form.placeOfSupply} onChange={(v) => set('placeOfSupply', v)} /></Field>
              )}
            </div>
            {(meta.needsRef || form.type === 'payment_receipt') && (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label={meta.needsRef ? 'Against invoice no. *' : 'Against invoice no. (optional)'}><input className="input" value={form.refNumber || ''} onChange={(e) => set('refNumber', e.target.value)} /></Field>
                <Field label="Invoice date"><input className="input" type="date" value={form.refDate || ''} onChange={(e) => set('refDate', e.target.value)} /></Field>
                <Field label="Reason"><input className="input" value={form.reason || ''} onChange={(e) => set('reason', e.target.value)} placeholder={form.type === 'debit_note' ? 'Extra freight, price revision…' : 'Goods returned, discount, advance…'} /></Field>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {form.type === 'tax_invoice' && (
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.reverseCharge} onChange={(e) => set('reverseCharge', e.target.checked)} /> Reverse charge applies</label>
              )}
              {form.type === 'quotation' && business.taxScheme === 'regular' && (
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.showTaxInQuotation} onChange={(e) => set('showTaxInQuotation', e.target.checked)} /> Show GST in quotation</label>
              )}
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.roundOffEnabled} onChange={(e) => set('roundOffEnabled', e.target.checked)} /> Round off total</label>
            </div>
          </section>

          {/* customer */}
          <section className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{meta.partyLabel}</h2>
              {!!customers?.length && (
                <select className="input max-w-xs" value="" onChange={(e) => pickCustomer(e.target.value)}>
                  <option value="">Pick a saved customer…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Customer name"><input className="input" value={form.party.name} placeholder="Leave empty for walk-in customer" onChange={(e) => setForm((p) => (p ? { ...p, party: { ...p.party, name: e.target.value, customerId: undefined } } : p))} /></Field>
              <Field label="GSTIN (if registered)" error={partyGstinBad ? 'Invalid GSTIN' : undefined}>
                <input
                  className="input uppercase"
                  maxLength={15}
                  value={form.party.gstin}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
                    setForm((p) => {
                      if (!p) return p;
                      const ok = isValidGstin(v);
                      const sc = ok ? stateFromGstin(v) : p.party.stateCode;
                      return { ...p, party: { ...p.party, gstin: v, stateCode: sc }, placeOfSupply: ok ? sc : p.placeOfSupply };
                    });
                  }}
                />
              </Field>
              <Field label="Address" className="md:col-span-2"><textarea className="input" rows={2} value={form.party.address} onChange={(e) => setParty('address', e.target.value)} /></Field>
              <Field label="State"><StateSelect value={form.party.stateCode} onChange={(v) => { setParty('stateCode', v); if (v) set('placeOfSupply', v); }} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone"><input className="input" inputMode="tel" value={form.party.phone} onChange={(e) => setParty('phone', e.target.value)} /></Field>
                <Field label="Email"><input className="input" type="email" value={form.party.email} onChange={(e) => setParty('email', e.target.value)} /></Field>
              </div>
            </div>
            {!existing && !form.party.customerId && (
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} /> Save this customer for next time</label>
            )}
          </section>

          {/* items */}
          <section className="card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Items</h2>
              <div className="flex gap-2">
                {!!items?.length && (
                  <select className="input max-w-[220px]" value="" onChange={(e) => addCatalogItem(e.target.value)}>
                    <option value="">Add from catalog…</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} – ₹{fmtMoney(i.rate)}</option>)}
                  </select>
                )}
                <button className="btn-ghost" onClick={() => set('lines', [...form.lines, blankLine()])}><Plus size={16} /> Blank line</button>
              </div>
            </div>
            <div className="space-y-3">
              {form.lines.map((l, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-12">
                    <Field label="Item name" className="col-span-2 md:col-span-5"><input className="input" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></Field>
                    <Field label="HSN/SAC" className="md:col-span-2"><input className="input" inputMode="numeric" value={l.hsn} onChange={(e) => setLine(i, { hsn: e.target.value.replace(/\D/g, '') })} /></Field>
                    <Field label="Qty" className="md:col-span-2"><NumInput value={l.qty} onChange={(n) => setLine(i, { qty: n })} /></Field>
                    <Field label="Unit" className="md:col-span-3">
                      <select className="input" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                    </Field>
                    <Field label={taxed && l.taxInclusive ? 'Rate (incl. GST)' : 'Rate (₹)'} className="md:col-span-3"><NumInput value={l.rate} onChange={(n) => setLine(i, { rate: n })} /></Field>
                    <Field label="Discount %" className="md:col-span-2"><NumInput value={l.discountPct} onChange={(n) => setLine(i, { discountPct: Math.min(100, n) })} /></Field>
                    {taxed && (
                      <Field label="GST %" className="md:col-span-2">
                        <select className="input" value={l.gstRate} onChange={(e) => setLine(i, { gstRate: Number(e.target.value) })}>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select>
                      </Field>
                    )}
                    {taxed && (
                      <label className="flex items-end gap-2 pb-2 text-xs md:col-span-2"><input type="checkbox" checked={l.taxInclusive} onChange={(e) => setLine(i, { taxInclusive: e.target.checked })} /> Rate has GST</label>
                    )}
                    <div className="col-span-2 flex items-end justify-between gap-2 md:col-span-3">
                      <div className="text-sm">
                        <div className="text-[11px] text-gray-500">Amount</div>
                        <div className="font-semibold">₹ {fmtMoney(taxed ? calc.lineCalcs[i].total : calc.lineCalcs[i].taxable)}</div>
                      </div>
                      <button className="btn-danger btn-sm" onClick={() => set('lines', form.lines.length > 1 ? form.lines.filter((_, j) => j !== i) : [blankLine()])} aria-label="Remove line"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Additional charges (freight, packing…)</h3>
                <button className="btn-ghost btn-sm" onClick={() => set('extras', [...form.extras, { label: '', amount: 0, gstRate: 18 }])}><Plus size={14} /> Add</button>
              </div>
              {form.extras.map((e, i) => (
                <div key={i} className="mb-2 grid grid-cols-[1fr_110px_90px_36px] items-end gap-2">
                  <Field label="Label"><input className="input" value={e.label} onChange={(ev) => set('extras', form.extras.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} /></Field>
                  <Field label="Amount"><NumInput value={e.amount} onChange={(n) => set('extras', form.extras.map((x, j) => (j === i ? { ...x, amount: n } : x)))} /></Field>
                  {taxed ? (
                    <Field label="GST %"><select className="input" value={e.gstRate} onChange={(ev) => set('extras', form.extras.map((x, j) => (j === i ? { ...x, gstRate: Number(ev.target.value) } : x)))}>{GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select></Field>
                  ) : <div />}
                  <button className="btn-danger btn-sm h-9" onClick={() => set('extras', form.extras.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Notes"><textarea className="input" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
              <Field label="Terms & conditions"><textarea className="input" rows={3} value={form.terms} onChange={(e) => set('terms', e.target.value)} /></Field>
            </div>
          </section>
        </div>

        {/* totals & payment */}
        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <section className="card">
            <h2 className="mb-2 font-semibold">Summary</h2>
            <dl className="space-y-1.5 text-sm">
              <Row k={taxed ? 'Sub total (excl. tax)' : 'Sub total'} v={lineGross} />
              {lineDisc > 0 && <Row k="Discount" v={-lineDisc} />}
              {calc.extraCalcs.map((c, i) => <Row key={i} k={form.extras[i].label || 'Additional charge'} v={c.taxable} />)}
              {taxed && <Row k="Taxable value" v={t.taxable} />}
              {t.cgst > 0 && <Row k="CGST" v={t.cgst} />}
              {t.sgst > 0 && <Row k="SGST" v={t.sgst} />}
              {t.igst > 0 && <Row k="IGST" v={t.igst} />}
              {t.roundOff !== 0 && <Row k="Round off" v={t.roundOff} />}
            </dl>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-brand-600 px-3 py-2.5 text-white">
              <span className="font-semibold">{form.type === 'credit_note' ? 'Credit total' : 'Total'}</span>
              <span className="text-lg font-bold">₹ {fmtMoney(t.total)}</span>
            </div>
            {taxed && form.placeOfSupply && (
              <p className="mt-2 text-xs text-gray-500">{calc.interState ? 'Inter-state supply: IGST applies.' : 'Intra-state supply: CGST + SGST apply.'}</p>
            )}
          </section>

          {meta.pay === 'track' && (
            <section className="card">
              <h2 className="mb-2 font-semibold">Payment</h2>
              {form.payments.map((p, i) => (
                <div key={i} className="mb-1 flex items-center justify-between text-sm">
                  <span>{p.date} · {p.mode}</span>
                  <span className="flex items-center gap-2">₹ {fmtMoney(p.amount)}
                    <button className="text-red-500" onClick={() => set('payments', form.payments.filter((_, j) => j !== i))} aria-label="Remove payment"><Trash2 size={13} /></button>
                  </span>
                </div>
              ))}
              <div className="mt-2 grid grid-cols-[1fr_100px] gap-2">
                <Field label="Received now (₹)"><NumInput value={receive.amount} onChange={(n) => setReceive({ ...receive, amount: n })} /></Field>
                <Field label="Mode">
                  <select className="input" value={receive.mode} onChange={(e) => setReceive({ ...receive, mode: e.target.value })}>
                    {['UPI', 'Cash', 'Card', 'Bank', 'Cheque'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </Field>
              </div>
              <button className="btn-ghost btn-sm mt-2" onClick={() => setReceive({ ...receive, amount: Math.max(0, Math.round((t.total - totalPaid) * 100) / 100) })}>Mark fully paid</button>
              <div className="mt-2 flex justify-between text-sm"><span className="text-gray-500">Balance after this</span><span className="font-semibold">₹ {fmtMoney(Math.max(0, t.total - totalPaid - receive.amount))}</span></div>
            </section>
          )}
        </aside>
      </div>

      {preview && (
        <Modal title="Preview" wide onClose={() => setPreview(null)}>
          <PdfPreview blob={preview} />
        </Modal>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-600">{k}</dt>
      <dd>{v < 0 ? '- ' : ''}₹ {fmtMoney(Math.abs(v))}</dd>
    </div>
  );
}

export default function EditPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500">Loading…</div>}>
      <Editor />
    </Suspense>
  );
}
