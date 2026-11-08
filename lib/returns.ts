import type { Business, Doc, DocType, LineCalc } from './types';
import { DOC_TYPES } from './types';
import { fmtDate, isValidGstin, round2 } from './gst';

/* ------------------------------------------------------------------ */
/* Period helpers                                                      */
/* ------------------------------------------------------------------ */

export interface ReturnPeriod {
  from: string; // yyyy-mm-dd inclusive
  to: string; // yyyy-mm-dd inclusive
  fp: string; // MMYYYY (filing period as used on the GST portal)
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

export function monthPeriod(ym: string): ReturnPeriod {
  const [y, m] = ym.split('-').map(Number);
  return {
    from: `${y}-${pad(m)}-01`,
    to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`,
    fp: `${pad(m)}${y}`,
    label: new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
  };
}

/** Quarter q (1-4) of the financial year starting in April of fyStartYear (Q1 = Apr-Jun). */
export function quarterPeriod(fyStartYear: number, q: 1 | 2 | 3 | 4): ReturnPeriod {
  const startMonth = 4 + (q - 1) * 3; // 4,7,10,13
  const sy = startMonth > 12 ? fyStartYear + 1 : fyStartYear;
  const sm = startMonth > 12 ? startMonth - 12 : startMonth;
  let em = sm + 2;
  let ey = sy;
  if (em > 12) {
    em -= 12;
    ey += 1;
  }
  return {
    from: `${sy}-${pad(sm)}-01`,
    to: `${ey}-${pad(em)}-${pad(lastDay(ey, em))}`,
    fp: `${pad(em)}${ey}`,
    label: `Q${q} FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const REPORTABLE: DocType[] = ['tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note'];

export function inPeriod(d: Doc, p: ReturnPeriod): boolean {
  return d.date >= p.from && d.date <= p.to;
}

/** Documents that count as supplies in a return: issued, not cancelled, not drafts. */
export function activeDocs(docs: Doc[], p: ReturnPeriod): Doc[] {
  return docs.filter(
    (d) => REPORTABLE.includes(d.type) && inPeriod(d, p) && d.status !== 'cancelled' && d.status !== 'draft',
  );
}

const sign = (d: Doc) => (d.type === 'credit_note' ? -1 : 1);
const isRegistered = (d: Doc) => isValidGstin(d.party.gstin);

interface RateBucket {
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
}

function allCalcs(d: Doc): LineCalc[] {
  return [...d.lineCalcs, ...(d.extraCalcs || [])];
}

function ratewise(d: Doc): RateBucket[] {
  const m = new Map<number, RateBucket>();
  for (const c of allCalcs(d)) {
    const b = m.get(c.gstRate) || { rt: c.gstRate, txval: 0, iamt: 0, camt: 0, samt: 0 };
    b.txval = round2(b.txval + c.taxable);
    b.iamt = round2(b.iamt + c.igst);
    b.camt = round2(b.camt + c.cgst);
    b.samt = round2(b.samt + c.sgst);
    m.set(c.gstRate, b);
  }
  return [...m.values()].sort((a, b) => a.rt - b.rt);
}

const itms = (buckets: RateBucket[], withCgst: boolean) =>
  buckets.map((b) => ({
    num: Math.round(b.rt * 100) + 1,
    itm_det: {
      rt: b.rt,
      txval: b.txval,
      iamt: b.iamt,
      ...(withCgst ? { camt: b.camt, samt: b.samt } : {}),
      csamt: 0,
    },
  }));

/* ------------------------------------------------------------------ */
/* GSTR-1                                                              */
/* ------------------------------------------------------------------ */

export interface Gstr1Result {
  json: Record<string, unknown>;
  warnings: string[];
  counts: { b2b: number; b2cl: number; b2cs: number; cdnr: number; cdnur: number; nil: number; hsn: number };
}

export function buildGstr1(
  docsAll: Doc[],
  business: Business,
  period: ReturnPeriod,
  opts: { grossTurnover?: number; currentGrossTurnover?: number } = {},
): Gstr1Result {
  const warnings: string[] = [];
  if (business.taxScheme !== 'regular') {
    warnings.push(
      'GSTR-1 applies to regular taxpayers only. Composition dealers file CMP-08 / GSTR-4 instead; unregistered businesses do not file GST returns.',
    );
  }
  if (!isValidGstin(business.gstin)) warnings.push('Your business GSTIN is missing or invalid.');

  const docs = activeDocs(docsAll, period);
  const taxInv = docs.filter((d) => d.type === 'tax_invoice');
  const bos = docs.filter((d) => d.type === 'bill_of_supply');
  const cns = docs.filter((d) => d.type === 'credit_note' || d.type === 'debit_note'); // CDNR notes (credit and debit)

  /* ---- B2B ---- */
  const b2bMap = new Map<string, unknown[]>();
  const b2cl: Doc[] = [];
  const b2csMap = new Map<string, { sply_ty: 'INTRA' | 'INTER'; rt: number; pos: string; txval: number; iamt: number; camt: number; samt: number }>();

  const addB2cs = (d: Doc, s: number) => {
    for (const b of ratewise(d)) {
      const sply = d.interState ? 'INTER' : 'INTRA';
      const key = `${sply}|${d.placeOfSupply}|${b.rt}`;
      const e = b2csMap.get(key) || { sply_ty: sply as 'INTRA' | 'INTER', rt: b.rt, pos: d.placeOfSupply, txval: 0, iamt: 0, camt: 0, samt: 0 };
      e.txval = round2(e.txval + s * b.txval);
      e.iamt = round2(e.iamt + s * b.iamt);
      e.camt = round2(e.camt + s * b.camt);
      e.samt = round2(e.samt + s * b.samt);
      b2csMap.set(key, e);
    }
  };

  let b2bCount = 0;
  for (const d of taxInv) {
    if (!d.placeOfSupply) warnings.push(`${d.number}: place of supply is missing.`);
    if (d.number.length > 16) warnings.push(`${d.number}: invoice number is longer than 16 characters (GST limit).`);
    if (isRegistered(d)) {
      const arr = b2bMap.get(d.party.gstin) || [];
      arr.push({
        inum: d.number,
        idt: fmtDate(d.date),
        val: d.totals.total,
        pos: d.placeOfSupply,
        rchrg: d.reverseCharge ? 'Y' : 'N',
        inv_typ: 'R',
        itms: itms(ratewise(d), !d.interState),
      });
      b2bMap.set(d.party.gstin, arr);
      b2bCount++;
    } else if (d.interState && d.totals.total > business.b2clThreshold) {
      b2cl.push(d);
    } else {
      addB2cs(d, 1);
    }
  }

  const b2b = [...b2bMap.entries()].map(([ctin, inv]) => ({ ctin, inv }));

  const b2clByPos = new Map<string, unknown[]>();
  for (const d of b2cl) {
    const arr = b2clByPos.get(d.placeOfSupply) || [];
    arr.push({ inum: d.number, idt: fmtDate(d.date), val: d.totals.total, itms: itms(ratewise(d), false).map((i) => ({ num: i.num, itm_det: { rt: i.itm_det.rt, txval: i.itm_det.txval, iamt: i.itm_det.iamt, csamt: 0 } })) });
    b2clByPos.set(d.placeOfSupply, arr);
  }
  const b2clJson = [...b2clByPos.entries()].map(([pos, inv]) => ({ pos, inv }));

  /* ---- Credit notes ---- */
  const cdnrMap = new Map<string, unknown[]>();
  const cdnur: unknown[] = [];
  let cdnrCount = 0;
  for (const d of cns) {
    if (!d.refNumber) warnings.push(`${d.number}: original invoice number is missing.`);
    const note = {
      ntty: d.type === 'debit_note' ? 'D' : 'C',
      nt_num: d.number,
      nt_dt: fmtDate(d.date),
      val: d.totals.total,
      pos: d.placeOfSupply,
      rchrg: d.reverseCharge ? 'Y' : 'N',
      inv_typ: 'R',
      itms: itms(ratewise(d), !d.interState),
    };
    if (isRegistered(d)) {
      const arr = cdnrMap.get(d.party.gstin) || [];
      arr.push(note);
      cdnrMap.set(d.party.gstin, arr);
      cdnrCount++;
    } else if (d.interState && d.totals.total > business.b2clThreshold) {
      cdnur.push({
        typ: 'B2CL',
        ntty: d.type === 'debit_note' ? 'D' : 'C',
        nt_num: d.number,
        nt_dt: fmtDate(d.date),
        val: d.totals.total,
        pos: d.placeOfSupply,
        itms: itms(ratewise(d), false),
      });
    } else {
      addB2cs(d, d.type === 'debit_note' ? 1 : -1); // small B2C credit notes reduce, debit notes add to B2CS
    }
  }
  const cdnr = [...cdnrMap.entries()].map(([ctin, nt]) => ({ ctin, nt }));

  /* ---- Nil / exempt (Bill of Supply) ---- */
  const nilMap = new Map<string, number>();
  for (const d of bos) {
    const reg = isRegistered(d);
    const key = `${d.interState ? 'INTER' : 'INTRA'}${reg ? 'B2B' : 'B2C'}`;
    const k = key === 'INTERB2B' ? 'INTERB2B' : key === 'INTERB2C' ? 'INTERB2C' : key === 'INTRAB2B' ? 'INTRAB2B' : 'INTRAB2C';
    nilMap.set(k, round2((nilMap.get(k) || 0) + d.totals.taxable));
  }
  const nilRows = [...nilMap.entries()].map(([sply_ty, amt]) => ({ sply_ty, expt_amt: 0, nil_amt: amt, ngsup_amt: 0 }));

  /* ---- HSN summary (B2B and B2C separately) ---- */
  type HsnRow = { hsn_sc: string; desc: string; uqc: string; qty: number; rt: number; val: number; txval: number; iamt: number; camt: number; samt: number };
  const hsnB2b = new Map<string, HsnRow>();
  const hsnB2c = new Map<string, HsnRow>();
  for (const d of [...taxInv, ...cns]) {
    const target = isRegistered(d) ? hsnB2b : hsnB2c;
    const s = sign(d);
    d.lines.forEach((l, i) => {
      const c = d.lineCalcs[i];
      if (!c) return;
      const isService = l.hsn.startsWith('99');
      const uqc = isService ? 'NA' : l.unit || 'OTH';
      const key = `${l.hsn}|${uqc}|${c.gstRate}`;
      const e = target.get(key) || { hsn_sc: l.hsn, desc: l.name.slice(0, 30), uqc, qty: 0, rt: c.gstRate, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0 };
      e.qty = isService ? 0 : round2(e.qty + s * l.qty);
      e.val = round2(e.val + s * c.total);
      e.txval = round2(e.txval + s * c.taxable);
      e.iamt = round2(e.iamt + s * c.igst);
      e.camt = round2(e.camt + s * c.cgst);
      e.samt = round2(e.samt + s * c.sgst);
      target.set(key, e);
      if (!l.hsn) warnings.push(`${d.number}: HSN/SAC missing for "${l.name}".`);
      else {
        const need = business.aggregateTurnoverAbove5Cr ? 6 : 4;
        if (l.hsn.length < need && (target === hsnB2b || business.aggregateTurnoverAbove5Cr))
          warnings.push(`${d.number}: HSN "${l.hsn}" for "${l.name}" has fewer than ${need} digits.`);
      }
    });
  }
  const toHsn = (m: Map<string, HsnRow>) =>
    [...m.values()].map((r, i) => ({ num: i + 1, ...r, csamt: 0 }));
  const hsn_b2b = toHsn(hsnB2b);
  const hsn_b2c = toHsn(hsnB2c);

  /* ---- Documents issued ---- */
  const issuedDocs = docsAll.filter((d) => REPORTABLE.includes(d.type) && inPeriod(d, period) && d.status !== 'draft');
  const series = (types: DocType[]) => {
    const rows: Record<string, unknown>[] = [];
    for (const t of types) {
      const list = issuedDocs.filter((d) => d.type === t).sort((a, b) => a.seq - b.seq);
      if (!list.length) continue;
      const first = list[0];
      const last = list[list.length - 1];
      const tot = last.seq - first.seq + 1;
      const cancel = list.filter((d) => d.status === 'cancelled').length;
      rows.push({ num: rows.length + 1, from: first.number, to: last.number, totnum: tot, cancel, net_issue: tot - cancel });
    }
    return rows;
  };
  const doc_det: unknown[] = [];
  const outward = series(['tax_invoice', 'bill_of_supply']);
  if (outward.length) doc_det.push({ doc_num: 1, docs: outward });
  const dnSeries = series(['debit_note']);
  if (dnSeries.length) doc_det.push({ doc_num: 4, docs: dnSeries });
  const cnSeries = series(['credit_note']);
  if (cnSeries.length) doc_det.push({ doc_num: 5, docs: cnSeries });

  /* ---- assemble ---- */
  const b2cs = [...b2csMap.values()].map((r) => ({ ...r, typ: 'OE', csamt: 0 }));
  const json: Record<string, unknown> = {
    gstin: business.gstin,
    fp: period.fp,
    gt: opts.grossTurnover ?? 0,
    cur_gt: opts.currentGrossTurnover ?? 0,
  };
  if (b2b.length) json.b2b = b2b;
  if (b2clJson.length) json.b2cl = b2clJson;
  if (b2cs.length) json.b2cs = b2cs;
  if (cdnr.length) json.cdnr = cdnr;
  if (cdnur.length) json.cdnur = cdnur;
  if (nilRows.length) json.nil = { inv: nilRows };
  if (hsn_b2b.length || hsn_b2c.length) json.hsn = { hsn_b2b, hsn_b2c };
  if (doc_det.length) json.doc_issue = { doc_det };

  if (!opts.grossTurnover) {
    warnings.push('Gross turnover (gt / cur_gt) is set to 0 in the JSON. The portal tool normally fills it itself; enter yours if it complains.');
  }

  return {
    json,
    warnings: [...new Set(warnings)],
    counts: { b2b: b2bCount, b2cl: b2cl.length, b2cs: b2cs.length, cdnr: cdnrCount, cdnur: cdnur.length, nil: nilRows.length, hsn: hsn_b2b.length + hsn_b2c.length },
  };
}

/* ------------------------------------------------------------------ */
/* GSTR-3B                                                             */
/* ------------------------------------------------------------------ */

export interface Gstr3bResult {
  json: Record<string, unknown>;
  summary: {
    outwardTaxable: { txval: number; igst: number; cgst: number; sgst: number; cess: number };
    nilExempt: number;
    interStateUnreg: { pos: string; txval: number; iamt: number }[];
    totalTax: number;
  };
  warnings: string[];
}

export function buildGstr3b(docsAll: Doc[], business: Business, period: ReturnPeriod): Gstr3bResult {
  const warnings: string[] = [
    'Table 4 (Input Tax Credit) is not computed: Atombook does not track purchases. Fill ITC on the portal from GSTR-2B.',
  ];
  const docs = activeDocs(docsAll, period);
  const out = { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  let nil = 0;
  const unreg = new Map<string, { pos: string; txval: number; iamt: number }>();

  for (const d of docs) {
    const s = sign(d);
    if (d.type === 'bill_of_supply') {
      nil = round2(nil + d.totals.taxable);
      continue;
    }
    for (const c of allCalcs(d)) {
      if (c.gstRate === 0) {
        nil = round2(nil + s * c.taxable);
        continue;
      }
      out.txval = round2(out.txval + s * c.taxable);
      out.igst = round2(out.igst + s * c.igst);
      out.cgst = round2(out.cgst + s * c.cgst);
      out.sgst = round2(out.sgst + s * c.sgst);
      if (d.interState && !isRegistered(d)) {
        const u = unreg.get(d.placeOfSupply) || { pos: d.placeOfSupply, txval: 0, iamt: 0 };
        u.txval = round2(u.txval + s * c.taxable);
        u.iamt = round2(u.iamt + s * c.igst);
        unreg.set(d.placeOfSupply, u);
      }
    }
  }

  const unregList = [...unreg.values()];
  const json = {
    gstin: business.gstin,
    ret_period: period.fp,
    sup_details: {
      osup_det: { txval: out.txval, iamt: out.igst, camt: out.cgst, samt: out.sgst, csamt: out.cess },
      osup_zero: { txval: 0, iamt: 0, csamt: 0 },
      osup_nil_exmp: { txval: nil },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: { txval: 0 },
    },
    inter_sup: { unreg_details: unregList, comp_details: [], uin_details: [] },
  };

  return {
    json,
    summary: {
      outwardTaxable: out,
      nilExempt: nil,
      interStateUnreg: unregList,
      totalTax: round2(out.igst + out.cgst + out.sgst + out.cess),
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Spreadsheet / CSV reports                                           */
/* ------------------------------------------------------------------ */

export interface Sheet {
  name: string;
  rows: (string | number)[][];
}

const TYPE_LABEL: Record<DocType, string> = {
  tax_invoice: 'Tax Invoice',
  bill_of_supply: 'Bill of Supply',
  quotation: 'Quotation',
  normal_bill: 'Bill',
  credit_note: 'Credit Note',
  debit_note: 'Debit Note',
  proforma_invoice: 'Proforma Invoice',
  delivery_challan: 'Delivery Challan',
  purchase_order: 'Purchase Order',
  payment_receipt: 'Payment Receipt',
};

export function buildReportSheets(docsAll: Doc[], business: Business, period: ReturnPeriod): Sheet[] {
  const docs = docsAll
    .filter((d) => inPeriod(d, period) && d.status !== 'draft' && DOC_TYPES[d.type].sales)
    .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);

  const register: Sheet = {
    name: 'Sales Register',
    rows: [
      ['Date', 'Type', 'Number', 'Party', 'GSTIN', 'Place of Supply', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round Off', 'Total', 'Status'],
      ...docs.map((d) => {
        const s = d.status === 'cancelled' ? 0 : sign(d);
        return [
          fmtDate(d.date), TYPE_LABEL[d.type], d.number, d.party.name, d.party.gstin, d.placeOfSupply,
          s * d.totals.taxable, s * d.totals.cgst, s * d.totals.sgst, s * d.totals.igst, s * d.totals.roundOff, s * d.totals.total, d.status,
        ];
      }),
    ],
  };

  const g1 = buildGstr1(docsAll, business, period);
  const hsn = (g1.json.hsn as { hsn_b2b: Record<string, number | string>[]; hsn_b2c: Record<string, number | string>[] } | undefined) || { hsn_b2b: [], hsn_b2c: [] };
  const hsnRows = (tag: string, list: Record<string, number | string>[]) =>
    list.map((r) => [tag, r.hsn_sc, r.desc, r.uqc, r.qty, r.rt, r.txval, r.iamt, r.camt, r.samt, r.val]);
  const hsnSheet: Sheet = {
    name: 'HSN Summary',
    rows: [
      ['Supply', 'HSN/SAC', 'Description', 'UQC', 'Qty', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST', 'Total Value'],
      ...hsnRows('B2B', hsn.hsn_b2b),
      ...hsnRows('B2C', hsn.hsn_b2c),
    ],
  };

  const g3 = buildGstr3b(docsAll, business, period);
  const o = g3.summary.outwardTaxable;
  const sheet3b: Sheet = {
    name: 'GSTR-3B Summary',
    rows: [
      ['Section', 'Taxable Value', 'IGST', 'CGST', 'SGST/UTGST', 'Cess'],
      ['3.1(a) Outward taxable supplies', o.txval, o.igst, o.cgst, o.sgst, o.cess],
      ['3.1(c) Nil rated / exempted', g3.summary.nilExempt, 0, 0, 0, 0],
      ['Total tax liability', '', g3.summary.totalTax, '', '', ''],
      [],
      ['3.2 Inter-state supplies to unregistered persons'],
      ['Place of Supply', 'Taxable Value', 'IGST'],
      ...g3.summary.interStateUnreg.map((u) => [u.pos, u.txval, u.iamt]),
    ],
  };

  return [register, hsnSheet, sheet3b];
}

export function sheetToCsv(sheet: Sheet): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return sheet.rows.map((r) => r.map(esc).join(',')).join('\n');
}
