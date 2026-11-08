import assert from 'node:assert/strict';
import { amountInWords, calcLine, fyCode, gstinChecksum, isValidGstin, round2, upiUri } from '../lib/gst';
import { buildDocPayload } from '../lib/build';
import { buildGstr1, buildGstr3b, monthPeriod, quarterPeriod } from '../lib/returns';
import { defaultBusiness } from '../lib/defaults';
import { formatNumber } from '../lib/db';
import type { Doc, LineItem } from '../lib/types';

let passed = 0;
const t = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n`, e);
    process.exitCode = 1;
  }
};

const line = (o: Partial<LineItem> = {}): LineItem => ({
  name: 'Widget', description: '', hsn: '8517', unit: 'NOS', qty: 1, rate: 100, discountPct: 0, gstRate: 18, taxInclusive: false, ...o,
});

/* ---- GSTIN ---- */
t('GSTIN checksum accepts a known valid GSTIN', () => {
  assert.equal(isValidGstin('27AAPFU0939F1ZV'), true);
});
t('GSTIN checksum rejects tampering', () => {
  assert.equal(isValidGstin('27AAPFU0939F1ZX'), false);
  assert.equal(isValidGstin('27AAPFU0939F1'), false);
  assert.equal(gstinChecksum('27AAPFU0939F1Z'), 'V');
});

/* ---- FY & numbering ---- */
t('financial year code', () => {
  assert.equal(fyCode('2026-03-31'), '2526');
  assert.equal(fyCode('2026-04-01'), '2627');
  assert.equal(fyCode('2026-10-31'), '2627');
});
t('invoice number formatting with {FY} token', () => {
  assert.equal(formatNumber({ prefix: 'INV/{FY}/', padding: 4, start: 1 }, '2627', 7), 'INV/2627/0007');
  assert.equal(formatNumber({ prefix: 'AB-', padding: 3, start: 1 }, '2627', 12), 'AB-012');
});

/* ---- line calculation ---- */
t('exclusive rate, intra-state splits CGST/SGST', () => {
  const c = calcLine(line({ qty: 2, rate: 500 }), false, true);
  assert.deepEqual([c.taxable, c.cgst, c.sgst, c.igst, c.total], [1000, 90, 90, 0, 1180]);
});
t('inter-state uses IGST', () => {
  const c = calcLine(line({ qty: 2, rate: 500 }), true, true);
  assert.deepEqual([c.cgst, c.sgst, c.igst, c.total], [0, 0, 180, 1180]);
});
t('inclusive rate backs tax out', () => {
  const c = calcLine(line({ rate: 118, taxInclusive: true }), false, true);
  assert.deepEqual([c.taxable, c.cgst, c.sgst, c.total], [100, 9, 9, 118]);
});
t('discount applies before tax', () => {
  const c = calcLine(line({ rate: 1000, discountPct: 10 }), false, true);
  assert.deepEqual([c.discount, c.taxable, c.cgst, c.total], [100, 900, 81, 1062]);
});
t('no tax when applyTax is false (bill of supply)', () => {
  const c = calcLine(line({ rate: 1000 }), false, false);
  assert.deepEqual([c.taxable, c.cgst, c.igst, c.total], [1000, 0, 0, 1000]);
});

/* ---- amount in words ---- */
t('amount in words uses lakh/crore', () => {
  assert.equal(amountInWords(123456.5), 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only');
  assert.equal(amountInWords(10000000), 'Rupees One Crore Only');
  assert.equal(amountInWords(0), 'Rupees Zero Only');
  assert.equal(amountInWords(1180), 'Rupees One Thousand One Hundred Eighty Only');
});

/* ---- UPI ---- */
t('UPI uri encodes name and amount', () => {
  assert.equal(
    upiUri({ vpa: 'shop@upi', name: 'My Shop', amount: 1180, note: 'INV/2627/0001' }),
    'upi://pay?pa=shop%40upi&pn=My%20Shop&am=1180.00&cu=INR&tn=INV%2F2627%2F0001',
  );
});

/* ---- documents & returns ---- */
const biz = { ...defaultBusiness(), name: 'Test Traders', stateCode: '08', gstin: '08AAAAA0000A1Z5', taxScheme: 'regular' as const };
// make GSTIN valid
biz.gstin = '08AAAAA0000A1Z' + gstinChecksum('08AAAAA0000A1Z');

const party = (gstin: string, state: string) => ({ name: 'P', gstin, address: '', stateCode: state, phone: '', email: '' });
let seq = 0;
const mk = (type: Doc['type'], date: string, gstin: string, pos: string, lines: LineItem[], extra: Partial<Doc> = {}): Doc => {
  seq++;
  const payload = buildDocPayload(
    { type, date, dueDate: date, party: party(gstin, pos), placeOfSupply: pos, lines, extras: [], reverseCharge: false, notes: '', terms: '', status: 'unpaid', payments: [], roundOffEnabled: true, showTaxInQuotation: false },
    biz,
  );
  return { ...payload, id: seq, seq, fy: '2627', number: `${type.slice(0, 2).toUpperCase()}/2627/${String(seq).padStart(4, '0')}`, ...extra };
};

const validB2B = '27AAPFU0939F1ZV';
const docs: Doc[] = [
  mk('tax_invoice', '2026-10-05', validB2B, '27', [line({ rate: 1000, qty: 2 })]), // inter-state B2B: 2000 + 360 IGST
  mk('tax_invoice', '2026-10-06', '', '08', [line({ rate: 500 })]), // intra B2CS: 500 + 45 + 45
  mk('tax_invoice', '2026-10-07', '', '29', [line({ rate: 200000 })]), // inter-state B2C large (> 1 lakh)
  mk('bill_of_supply', '2026-10-08', '', '08', [line({ rate: 300, gstRate: 0 })]),
  mk('credit_note', '2026-10-20', validB2B, '27', [line({ rate: 1000 })], { refNumber: 'TA/2627/0001', refDate: '2026-10-05' }),
  mk('tax_invoice', '2026-10-21', '', '08', [line({ rate: 999 })], { status: 'cancelled' }),
  mk('tax_invoice', '2026-11-02', '', '08', [line({ rate: 999 })]), // next month: excluded
  mk('quotation', '2026-10-10', '', '08', [line({ rate: 999 })]), // never reported
];
const oct = monthPeriod('2026-10');

t('document totals: round off to nearest rupee', () => {
  const d = mk('tax_invoice', '2026-10-05', '', '08', [line({ rate: 333.33 })]);
  assert.equal(d.totals.total, Math.round(d.totals.taxable + d.totals.tax));
  assert.equal(round2(d.totals.taxable + d.totals.tax + d.totals.roundOff), d.totals.total);
});
t('quotation and bill have no tax unless enabled', () => {
  assert.equal(docs[7].totals.tax, 0);
});
t('composition dealer cannot charge GST on quotations either', () => {
  const comp = { ...biz, taxScheme: 'composition' as const };
  const p = buildDocPayload(
    { type: 'quotation', date: '2026-10-10', dueDate: '', party: party('', '08'), placeOfSupply: '08', lines: [line()], extras: [], reverseCharge: false, notes: '', terms: '', status: 'draft', payments: [], roundOffEnabled: false, showTaxInQuotation: true },
    comp,
  );
  assert.equal(p.totals.tax, 0);
});

const g1 = buildGstr1(docs, biz, oct);
const j = g1.json as any;

t('GSTR-1 header', () => {
  assert.equal(j.gstin, biz.gstin);
  assert.equal(j.fp, '102026');
});
t('GSTR-1 B2B groups by GSTIN with dd-mm-yyyy dates and IGST only', () => {
  assert.equal(j.b2b.length, 1);
  assert.equal(j.b2b[0].ctin, validB2B);
  assert.equal(j.b2b[0].inv[0].idt, '05-10-2026');
  assert.deepEqual(j.b2b[0].inv[0].itms[0].itm_det, { rt: 18, txval: 2000, iamt: 360, csamt: 0 });
  assert.equal(j.b2b[0].inv[0].pos, '27');
});
t('GSTR-1 B2CL picks inter-state unregistered above threshold', () => {
  assert.equal(j.b2cl.length, 1);
  assert.equal(j.b2cl[0].pos, '29');
});
t('GSTR-1 B2CS aggregates small intra-state sale', () => {
  const r = j.b2cs.find((x: any) => x.sply_ty === 'INTRA');
  assert.deepEqual([r.txval, r.camt, r.samt, r.rt], [500, 45, 45, 18]);
});
t('GSTR-1 credit note goes to CDNR', () => {
  assert.equal(j.cdnr[0].nt[0].ntty, 'C');
  assert.equal(j.cdnr[0].nt[0].val, 1180);
});
t('GSTR-1 bill of supply goes to nil section', () => {
  assert.deepEqual(j.nil.inv, [{ sply_ty: 'INTRAB2C', expt_amt: 0, nil_amt: 300, ngsup_amt: 0 }]);
});
t('GSTR-1 HSN split by B2B / B2C, credit note reduces B2B', () => {
  assert.equal(j.hsn.hsn_b2b[0].txval, 1000); // 2000 invoice - 1000 credit note
  assert.ok(j.hsn.hsn_b2c.length >= 1);
});
t('GSTR-1 document issue counts cancelled', () => {
  const rows = j.doc_issue.doc_det.find((x: any) => x.doc_num === 1).docs;
  const ti = rows[0];
  assert.equal(ti.cancel, 1);
  assert.equal(ti.net_issue, ti.totnum - 1);
  assert.equal(j.doc_issue.doc_det.find((x: any) => x.doc_num === 5).docs[0].totnum, 1);
});
t('cancelled, quotation and next-month docs are excluded', () => {
  const count = g1.counts.b2b + g1.counts.b2cl;
  assert.equal(count, 2);
});

t('GSTR-3B nets credit notes and separates nil supplies', () => {
  const r = buildGstr3b(docs, biz, oct);
  const o = r.summary.outwardTaxable;
  // taxable: 2000 + 500 + 200000 - 1000 = 201500
  assert.equal(o.txval, 201500);
  assert.equal(o.igst, round2(360 + 36000 - 180));
  assert.equal(o.cgst, 45);
  assert.equal(o.sgst, 45);
  assert.equal(r.summary.nilExempt, 300);
  assert.equal(r.summary.interStateUnreg[0].pos, '29');
});

t('composition dealer gets a GSTR-1 warning', () => {
  const r = buildGstr1(docs, { ...biz, taxScheme: 'composition' }, oct);
  assert.ok(r.warnings.some((w) => /composition/i.test(w)));
});

t('quarter periods follow the financial year', () => {
  const q3 = quarterPeriod(2026, 3);
  assert.deepEqual([q3.from, q3.to, q3.fp], ['2026-10-01', '2026-12-31', '122026']);
  const q4 = quarterPeriod(2026, 4);
  assert.deepEqual([q4.from, q4.to, q4.fp], ['2027-01-01', '2027-03-31', '032027']);
});

/* ---- new document categories & zero billing ---- */
import { statusFor } from '../lib/build';
import { DOC_TYPES, DOC_TYPE_LIST } from '../lib/types';

t('every document type has numbering metadata', () => {
  assert.equal(DOC_TYPE_LIST.length, 10);
  for (const k of DOC_TYPE_LIST) assert.ok(DOC_TYPES[k].defaultPrefix.includes('{FY}'), k);
  assert.equal(Object.keys(defaultBusiness().numbering).length, 10);
});
t('proforma invoice charges GST but is not reported in returns', () => {
  const d = mk('proforma_invoice', '2026-10-12', '', '08', [line({ rate: 1000 })]);
  assert.equal(d.totals.tax, 180);
  const r = buildGstr1([d], biz, oct).json as any;
  assert.equal(r.b2cs, undefined);
});
t('delivery challan, purchase order and receipt carry no GST', () => {
  for (const ty of ['delivery_challan', 'purchase_order', 'payment_receipt'] as const) {
    const d = mk(ty, '2026-10-12', '', '08', [line({ rate: 1000 })]);
    assert.equal(d.totals.tax, 0, ty);
    assert.equal(d.totals.total, 1000, ty);
  }
});
t('debit note goes to CDNR as type D and adds to the invoice figures', () => {
  const inv = mk('tax_invoice', '2026-10-05', validB2B, '27', [line({ rate: 1000 })]);
  const dn = mk('debit_note', '2026-10-15', validB2B, '27', [line({ rate: 500 })], { refNumber: inv.number, refDate: inv.date });
  const out = buildGstr1([inv, dn], biz, oct).json as any;
  assert.equal(out.cdnr[0].nt[0].ntty, 'D');
  assert.equal(out.cdnr[0].nt[0].val, 590);
  assert.equal(out.hsn.hsn_b2b[0].txval, 1500); // 1000 invoice + 500 debit note
  assert.equal(out.doc_issue.doc_det.find((x: any) => x.doc_num === 4).docs[0].totnum, 1);
  const r3 = buildGstr3b([inv, dn], biz, oct) as any;
  assert.ok(JSON.stringify(r3).includes('1500'));
});
t('zero value bills are allowed and count as paid', () => {
  const d = mk('normal_bill', '2026-10-12', '', '08', [line({ rate: 0 })]);
  assert.equal(d.totals.total, 0);
  assert.equal(statusFor('normal_bill', 0, []), 'paid');
  assert.equal(statusFor('tax_invoice', 118, []), 'unpaid');
  assert.equal(statusFor('quotation', 118, []), 'draft');
  assert.equal(statusFor('payment_receipt', 118, []), 'paid');
});

console.log(`\n${passed} tests passed`);
