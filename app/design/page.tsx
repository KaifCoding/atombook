'use client';

import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Field, PageHeader, toast } from '@/components/ui';
import { PdfPreview } from '@/components/PdfPreview';
import { saveDesign, formatNumber } from '@/lib/db';
import { useBusiness, useDesign, useDocs } from '@/lib/hooks';
import { buildDocPayload } from '@/lib/build';
import { defaultDesign } from '@/lib/defaults';
import { renderInvoicePdf } from '@/lib/pdf';
import { fyCode, todayStr } from '@/lib/gst';
import { DOC_TYPES, type DesignConfig, type Doc, type DocType, type TemplateId } from '@/lib/types';

const TEMPLATES: { id: TemplateId; name: string; desc: string }[] = [
  { id: 'classic', name: 'Classic', desc: 'Coloured title bar, boxed sections' },
  { id: 'modern', name: 'Modern', desc: 'Full-width coloured header band' },
  { id: 'minimal', name: 'Minimal', desc: 'Clean lines, no fills' },
];

const SWATCHES = ['#1d4ed8', '#047857', '#b91c1c', '#7c3aed', '#c2410c', '#0f172a', '#0e7490', '#be185d'];

const TOGGLES: [keyof DesignConfig, string][] = [
  ['showLogo', 'Logo'], ['showTagline', 'Tagline'], ['showGstin', 'GSTIN in header'], ['showSerial', 'Serial number column'],
  ['showHsn', 'HSN/SAC column'], ['showUnit', 'Unit column'], ['showDiscount', 'Discount column'], ['showGstRate', 'GST % column'],
  ['showTaxSummary', 'Tax summary table'], ['showPlaceOfSupply', 'Place of supply'], ['showAmountInWords', 'Amount in words'], ['showBank', 'Bank details'],
  ['showQr', 'Payment QR'], ['showSignature', 'Signature'], ['showSeal', 'Seal / stamp'], ['showNotes', 'Notes'],
  ['showTerms', 'Terms & conditions'], ['showPageNumbers', 'Page numbers'], ['zebra', 'Striped rows'],
];

export default function DesignPage() {
  const saved = useDesign();
  const business = useBusiness();
  const docs = useDocs();
  const [d, setD] = useState<DesignConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sampleType, setSampleType] = useState<DocType>('tax_invoice');
  const [useReal, setUseReal] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);

  // Show data that arrives from another device (Google Drive sync), unless the user is mid-edit.
  useEffect(() => {
    if (saved && (!d || (!dirty && saved.updatedAt !== d.updatedAt))) setD(saved);
  }, [saved, d, dirty]);

  const sample: Doc | null = useMemo(() => {
    if (!business) return null;
    if (useReal) {
      const real = docs?.find((x) => x.type === sampleType && x.status !== 'cancelled') || docs?.find((x) => x.status !== 'cancelled');
      if (real) return real;
    }
    const pos = business.stateCode === '27' ? '29' : business.stateCode || '27';
    const lines = [
      { name: 'Sample product A', description: 'Short description', hsn: '8517', unit: 'NOS', qty: 2, rate: 1250, discountPct: 0, gstRate: 18, taxInclusive: false },
      { name: 'Sample product B', description: '', hsn: '6109', unit: 'PCS', qty: 5, rate: 399, discountPct: 10, gstRate: 12, taxInclusive: false },
      { name: 'Consulting service', description: 'Per hour', hsn: '998313', unit: 'HRS', qty: 3, rate: 1500, discountPct: 0, gstRate: 18, taxInclusive: false },
    ];
    const payload = buildDocPayload(
      {
        type: sampleType, date: todayStr(), dueDate: todayStr(), placeOfSupply: pos,
        party: { name: 'Sample Customer Pvt Ltd', gstin: '', address: '221B Sample Street, City', stateCode: pos, phone: '9876543210', email: 'customer@example.com' },
        lines: !DOC_TYPES[sampleType].hasTax ? lines.map((l) => ({ ...l, gstRate: 0 })) : lines,
        extras: [{ label: 'Freight', amount: 150, gstRate: 18 }], reverseCharge: false, notes: business.defaultNotes || 'Thank you for choosing us.',
        terms: business.defaultTerms, status: 'unpaid', payments: [], roundOffEnabled: true, showTaxInQuotation: true,
        refNumber: DOC_TYPES[sampleType].needsRef ? 'INV/0001' : undefined, refDate: DOC_TYPES[sampleType].needsRef ? todayStr() : undefined, reason: DOC_TYPES[sampleType].needsRef ? 'Goods returned' : undefined,
      },
      business,
    );
    return { ...payload, id: 0, seq: 1, fy: fyCode(todayStr()), number: formatNumber(business.numbering[sampleType], fyCode(todayStr()), 1) };
  }, [business, docs, sampleType, useReal]);

  // debounced live preview
  useEffect(() => {
    if (!d || !business || !sample) return;
    const h = setTimeout(() => {
      renderInvoicePdf(sample, business, d).then(setBlob).catch((e) => toast(e.message || 'Preview failed', 'error'));
    }, 500);
    return () => clearTimeout(h);
  }, [d, business, sample]);

  if (!d) return <div className="text-sm text-gray-500">Loading…</div>;

  const set = <K extends keyof DesignConfig>(k: K, v: DesignConfig[K]) => {
    setD((p) => (p ? { ...p, [k]: v } : p));
    setDirty(true);
  };
  const setLabel = (k: keyof DesignConfig['labels'], v: string) => {
    setD((p) => (p ? { ...p, labels: { ...p.labels, [k]: v } } : p));
    setDirty(true);
  };
  const setAccent = (c: string) => {
    setD((p) => (p ? { ...p, accent: c, tableHeaderBg: c } : p));
    setDirty(true);
  };

  const save = async () => {
    await saveDesign(d);
    setDirty(false);
    toast('Design saved. All documents will use it.');
  };

  return (
    <div>
      <PageHeader
        title="Invoice Design"
        subtitle="Changes apply to every PDF, including documents you made earlier."
        actions={
          <>
            <button className="btn-ghost" onClick={() => { setD({ ...defaultDesign() }); setDirty(true); }}><RotateCcw size={16} /> Reset</button>
            <button className="btn-primary" onClick={save} disabled={!dirty}><Save size={16} /> Save design</button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
        <div className="space-y-4">
          <section className="card">
            <h2 className="mb-2 text-sm font-semibold">Template</h2>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => set('template', t.id)} className={`rounded-lg border p-2 text-left ${d.template === t.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-[11px] text-gray-500">{t.desc}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="card space-y-3">
            <h2 className="text-sm font-semibold">Colours &amp; type</h2>
            <div>
              <span className="label">Accent colour</span>
              <div className="flex flex-wrap items-center gap-2">
                {SWATCHES.map((c) => (
                  <button key={c} onClick={() => setAccent(c)} className={`h-7 w-7 rounded-full border-2 ${d.accent === c ? 'border-gray-900' : 'border-white shadow'}`} style={{ background: c }} aria-label={c} />
                ))}
                <input type="color" value={d.accent} onChange={(e) => setAccent(e.target.value)} className="h-8 w-10 cursor-pointer rounded border" aria-label="Custom colour" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Table header colour"><input type="color" className="h-9 w-full cursor-pointer rounded border" value={d.tableHeaderBg} onChange={(e) => set('tableHeaderBg', e.target.value)} /></Field>
              <Field label="Table header text"><input type="color" className="h-9 w-full cursor-pointer rounded border" value={d.tableHeaderText} onChange={(e) => set('tableHeaderText', e.target.value)} /></Field>
              <Field label="Font">
                <select className="input" value={d.fontFamily} onChange={(e) => set('fontFamily', e.target.value as DesignConfig['fontFamily'])}>
                  <option value="NotoSans">Noto Sans (₹ symbol)</option><option value="Helvetica">Helvetica (Rs.)</option><option value="Times-Roman">Times (Rs.)</option>
                </select>
              </Field>
              <Field label={`Font size (${d.fontSize}pt)`}><input type="range" min={7} max={12} step={0.5} className="w-full" value={d.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))} /></Field>
              <Field label="Paper">
                <select className="input" value={d.paper} onChange={(e) => set('paper', e.target.value as DesignConfig['paper'])}>
                  <option value="A4">A4</option><option value="A5">A5</option><option value="LETTER">Letter</option>
                </select>
              </Field>
              <Field label="Logo position">
                <select className="input" value={d.logoPosition} onChange={(e) => set('logoPosition', e.target.value as DesignConfig['logoPosition'])}>
                  <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                </select>
              </Field>
              <Field label={`Logo size (${d.logoSize})`} className="col-span-2"><input type="range" min={30} max={110} className="w-full" value={d.logoSize} onChange={(e) => set('logoSize', Number(e.target.value))} /></Field>
              <Field label="Seal position">
                <select className="input" value={d.sealPosition} onChange={(e) => set('sealPosition', e.target.value as DesignConfig['sealPosition'])}>
                  <option value="right">Right of signature</option><option value="left">Left of signature</option><option value="center">Over signature</option>
                </select>
              </Field>
              <Field label={`Seal size (${d.sealSize})`}><input type="range" min={40} max={140} className="w-full" value={d.sealSize} onChange={(e) => set('sealSize', Number(e.target.value))} /></Field>
              <Field label={`Signature size (${d.signatureSize})`} className="col-span-2"><input type="range" min={50} max={150} className="w-full" value={d.signatureSize} onChange={(e) => set('signatureSize', Number(e.target.value))} /></Field>
            </div>
          </section>

          <section className="card">
            <h2 className="mb-2 text-sm font-semibold">Show / hide</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {TOGGLES.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={d[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} /> {label}</label>
              ))}
            </div>
          </section>

          <section className="card space-y-3">
            <h2 className="text-sm font-semibold">Wording</h2>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(DOC_TYPES) as DocType[]).map((t) => (
                <Field key={t} label={`Title: ${DOC_TYPES[t].label}`}><input className="input" value={d.labels[t]} onChange={(e) => setLabel(t, e.target.value)} /></Field>
              ))}
              <Field label="“Bill to” label"><input className="input" value={d.labels.billTo} onChange={(e) => setLabel('billTo', e.target.value)} /></Field>
              <Field label="Signature line (For …)"><input className="input" value={d.labels.signatory} onChange={(e) => setLabel('signatory', e.target.value)} /></Field>
            </div>
            <Field label="Thank-you line"><input className="input" value={d.labels.thanks} onChange={(e) => setLabel('thanks', e.target.value)} /></Field>
            <Field label="Header note (under title)"><input className="input" value={d.headerNote} onChange={(e) => set('headerNote', e.target.value)} /></Field>
            <Field label="Footer text"><input className="input" value={d.footerText} onChange={(e) => set('footerText', e.target.value)} /></Field>
            <Field label="Watermark text" hint="e.g. ORIGINAL, COPY. Cancelled documents always show CANCELLED."><input className="input" value={d.watermark} onChange={(e) => set('watermark', e.target.value)} /></Field>
          </section>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <select className="input !w-auto" value={sampleType} onChange={(e) => setSampleType(e.target.value as DocType)}>
              {(Object.keys(DOC_TYPES) as DocType[]).map((t) => <option key={t} value={t}>{DOC_TYPES[t].label}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useReal} onChange={(e) => setUseReal(e.target.checked)} /> Preview with my latest document</label>
          </div>
          <div className="max-h-[calc(100vh-120px)] overflow-y-auto rounded-xl bg-gray-200 p-3">
            {blob ? <PdfPreview blob={blob} /> : <div className="p-10 text-center text-sm text-gray-500">Rendering preview…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
