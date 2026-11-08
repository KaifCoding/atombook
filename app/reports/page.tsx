'use client';

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, Download, FileJson, FileSpreadsheet } from 'lucide-react';
import { Field, PageHeader, toast } from '@/components/ui';
import { useBusiness, useDocs } from '@/lib/hooks';
import { buildGstr1, buildGstr3b, buildReportSheets, monthPeriod, quarterPeriod, sheetToCsv, activeDocs } from '@/lib/returns';
import { fmtDate, fmtMoney, todayStr } from '@/lib/gst';
import { saveBlob, saveJson, saveText } from '@/lib/files';
import { DOC_TYPES } from '@/lib/types';

export default function ReportsPage() {
  const business = useBusiness();
  const docs = useDocs();
  const now = new Date();
  const fyStart = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;

  const [mode, setMode] = useState<'month' | 'quarter' | null>(null);
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [fy, setFy] = useState(fyStart);
  const [q, setQ] = useState<1 | 2 | 3 | 4>(1);

  const effMode = mode ?? (business && !business.monthlyFiler ? 'quarter' : 'month');
  const period = useMemo(() => (effMode === 'month' ? monthPeriod(month) : quarterPeriod(fy, q)), [effMode, month, fy, q]);

  const data = useMemo(() => {
    if (!business || !docs) return null;
    return {
      g1: buildGstr1(docs, business, period),
      g3: buildGstr3b(docs, business, period),
      list: activeDocs(docs, period).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [business, docs, period]);

  if (!business || !docs || !data) return <div className="text-sm text-gray-500">Loading…</div>;

  const { g1, g3, list } = data;
  const s = g3.summary;
  const file = (kind: string, ext: string) => `${kind}_${business.gstin || 'NOGSTIN'}_${period.fp}.${ext}`;

  const run = (fn: () => Promise<void> | void) => async () => {
    try {
      await fn();
      toast('File created');
    } catch (e) {
      toast((e as Error).message || 'Could not create the file', 'error');
    }
  };

  const downloadXlsx = async () => {
    const wb = XLSX.utils.book_new();
    for (const sh of buildReportSheets(docs, business, period)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name.slice(0, 31));
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    await saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file('GST_Reports', 'xlsx'));
  };

  const sheets = () => buildReportSheets(docs, business, period);

  return (
    <div className="space-y-5">
      <PageHeader title="GST Returns" subtitle="Prepare GSTR-1 and GSTR-3B data from your documents, then upload the JSON on the GST portal." />

      <section className="card">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Return period">
            <select className="input" value={effMode} onChange={(e) => setMode(e.target.value as 'month' | 'quarter')}>
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly (QRMP)</option>
            </select>
          </Field>
          {effMode === 'month' ? (
            <Field label="Month"><input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
          ) : (
            <>
              <Field label="Financial year starting">
                <select className="input" value={fy} onChange={(e) => setFy(Number(e.target.value))}>
                  {[fyStart + 1, fyStart, fyStart - 1, fyStart - 2].map((y) => <option key={y} value={y}>{y}-{String(y + 1).slice(-2)}</option>)}
                </select>
              </Field>
              <Field label="Quarter">
                <select className="input" value={q} onChange={(e) => setQ(Number(e.target.value) as 1 | 2 | 3 | 4)}>
                  <option value={1}>Q1 (Apr–Jun)</option><option value={2}>Q2 (Jul–Sep)</option><option value={3}>Q3 (Oct–Dec)</option><option value={4}>Q4 (Jan–Mar)</option>
                </select>
              </Field>
            </>
          )}
          <div className="pb-2 text-sm text-gray-500">{fmtDate(period.from)} to {fmtDate(period.to)} · {list.length} documents</div>
        </div>
      </section>

      {g1.warnings.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle size={16} /> Check before filing</div>
          <ul className="list-disc space-y-0.5 pl-5">{g1.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 font-semibold">GSTR-1 (outward supplies)</h2>
          <p className="mb-3 text-xs text-gray-500">Import this JSON in the GSTR-1 section of the GST portal (or the offline tool), then review and file.</p>
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Stat k="B2B invoices" v={g1.counts.b2b} /><Stat k="B2C large invoices" v={g1.counts.b2cl} />
            <Stat k="B2C small (rows)" v={g1.counts.b2cs} /><Stat k="Credit notes (registered)" v={g1.counts.cdnr} />
            <Stat k="Credit notes (unreg.)" v={g1.counts.cdnur} /><Stat k="Nil / exempt rows" v={g1.counts.nil} />
            <Stat k="HSN rows" v={g1.counts.hsn} />
          </dl>
          <button className="btn-primary" onClick={run(() => saveJson(g1.json, file('GSTR1', 'json')))}><FileJson size={16} /> Download GSTR-1 JSON</button>
        </section>

        <section className="card">
          <h2 className="mb-1 font-semibold">GSTR-3B (summary)</h2>
          <p className="mb-3 text-xs text-gray-500">Outward supply figures for Table 3.1 and 3.2. Fill ITC (Table 4) on the portal from GSTR-2B.</p>
          <table className="mb-4 w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1"></th><th className="text-right">Taxable</th><th className="text-right">IGST</th><th className="text-right">CGST</th><th className="text-right">SGST</th></tr></thead>
            <tbody>
              <tr className="border-t"><td className="py-1.5">3.1(a) Taxable supplies</td><td className="text-right">{fmtMoney(s.outwardTaxable.txval)}</td><td className="text-right">{fmtMoney(s.outwardTaxable.igst)}</td><td className="text-right">{fmtMoney(s.outwardTaxable.cgst)}</td><td className="text-right">{fmtMoney(s.outwardTaxable.sgst)}</td></tr>
              <tr className="border-t"><td className="py-1.5">3.1(c) Nil / exempt</td><td className="text-right">{fmtMoney(s.nilExempt)}</td><td /><td /><td /></tr>
              <tr className="border-t font-semibold"><td className="py-1.5">Total tax</td><td /><td className="text-right" colSpan={3}>₹ {fmtMoney(s.totalTax)}</td></tr>
            </tbody>
          </table>
          <button className="btn-primary" onClick={run(() => saveJson(g3.json, file('GSTR3B', 'json')))}><FileJson size={16} /> Download GSTR-3B JSON</button>
        </section>
      </div>

      <section className="card">
        <h2 className="mb-3 font-semibold">Reports for your accountant</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={run(downloadXlsx)}><FileSpreadsheet size={16} /> Excel workbook (all reports)</button>
          <button className="btn-ghost" onClick={run(() => saveText(sheetToCsv(sheets()[0]), file('SalesRegister', 'csv'), 'text/csv'))}><Download size={16} /> Sales register CSV</button>
          <button className="btn-ghost" onClick={run(() => saveText(sheetToCsv(sheets()[1]), file('HSN_Summary', 'csv'), 'text/csv'))}><Download size={16} /> HSN summary CSV</button>
          <button className="btn-ghost" onClick={run(() => saveText(sheetToCsv(sheets()[2]), file('GSTR3B_Summary', 'csv'), 'text/csv'))}><Download size={16} /> GSTR-3B summary CSV</button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Documents in this period</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full">
            <thead className="border-b bg-gray-50"><tr><th className="th">Number</th><th className="th">Type</th><th className="th">Date</th><th className="th">Customer</th><th className="th text-right">Taxable</th><th className="th text-right">Tax</th><th className="th text-right">Total</th></tr></thead>
            <tbody className="divide-y">
              {list.map((d) => {
                const sg = d.type === 'credit_note' ? -1 : 1;
                return (
                  <tr key={d.id}>
                    <td className="td font-mono text-xs">{d.number}</td><td className="td">{DOC_TYPES[d.type].label}</td><td className="td">{fmtDate(d.date)}</td>
                    <td className="td">{d.party.name}</td><td className="td text-right">{fmtMoney(sg * d.totals.taxable)}</td><td className="td text-right">{fmtMoney(sg * d.totals.tax)}</td><td className="td text-right">{fmtMoney(sg * d.totals.total)}</td>
                  </tr>
                );
              })}
              {!list.length && <tr><td className="td text-center text-gray-400" colSpan={7}>No tax invoices, bills of supply or credit notes in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-gray-400">
        AtomBook prepares data from the documents you create here. Verify it against your books, and validate the JSON in the GST portal / offline tool before filing. GST formats and thresholds can change.
      </p>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <>
      <dt className="text-gray-600">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </>
  );
}
