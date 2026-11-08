import type { DocType, ExtraCharge, LineCalc, LineItem, Totals } from './types';
import { DOC_TYPES } from './types';

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28];
export const UNITS = ['NOS', 'PCS', 'KGS', 'GMS', 'LTR', 'MTR', 'BOX', 'SET', 'PAC', 'HRS', 'DAY', 'MON', 'SQF', 'SQM', 'OTH'];

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ */
/* GSTIN                                                               */
/* ------------------------------------------------------------------ */

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinChecksum(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    const prod = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin: string): boolean {
  const g = (gstin || '').trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return false;
  return gstinChecksum(g.slice(0, 14)) === g[14];
}

export function stateFromGstin(gstin: string): string {
  const g = (gstin || '').trim();
  return /^\d{2}/.test(g) ? g.slice(0, 2) : '';
}

/* ------------------------------------------------------------------ */
/* Financial year                                                      */
/* ------------------------------------------------------------------ */

/** "2025-10-31" -> "2526" */
export function fyCode(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

/** "2526" -> "2025-26" */
export function fyLabel(code: string): string {
  const a = Number(code.slice(0, 2));
  return `20${String(a).padStart(2, '0')}-${code.slice(2)}`;
}

export function todayStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** yyyy-mm-dd -> dd-mm-yyyy */
export function fmtDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
}

/* ------------------------------------------------------------------ */
/* Calculation                                                         */
/* ------------------------------------------------------------------ */

export function taxApplies(type: DocType, showTaxInQuotation: boolean): boolean {
  if (type === 'tax_invoice' || type === 'credit_note' || type === 'debit_note' || type === 'proforma_invoice') return true;
  if (type === 'quotation') return showTaxInQuotation;
  return false;
}

export function calcLine(line: LineItem, interState: boolean, applyTax: boolean): LineCalc {
  const rate = applyTax ? line.gstRate : 0;
  const base = line.qty * line.rate;
  const exGross = applyTax && line.taxInclusive ? base / (1 + rate / 100) : base;
  const disc = (exGross * (line.discountPct || 0)) / 100;
  const taxable = round2(exGross - disc);
  let cgst = 0,
    sgst = 0,
    igst = 0;
  if (rate > 0) {
    if (interState) igst = round2((taxable * rate) / 100);
    else {
      cgst = round2((taxable * rate) / 200);
      sgst = cgst;
    }
  }
  return {
    gross: round2(exGross),
    discount: round2(disc),
    taxable,
    gstRate: rate,
    cgst,
    sgst,
    igst,
    total: round2(taxable + cgst + sgst + igst),
  };
}

export function calcExtra(e: ExtraCharge, interState: boolean, applyTax: boolean): LineCalc {
  return calcLine(
    {
      name: e.label,
      description: '',
      hsn: '',
      unit: '',
      qty: 1,
      rate: e.amount,
      discountPct: 0,
      gstRate: e.gstRate,
      taxInclusive: false,
    },
    interState,
    applyTax,
  );
}

export interface CalcResult {
  lineCalcs: LineCalc[];
  extraCalcs: LineCalc[];
  totals: Totals;
  interState: boolean;
}

export function calcDocument(args: {
  type: DocType;
  lines: LineItem[];
  extras: ExtraCharge[];
  businessState: string;
  placeOfSupply: string;
  roundOff: boolean;
  showTaxInQuotation: boolean;
}): CalcResult {
  const { type, lines, extras, businessState, placeOfSupply, roundOff, showTaxInQuotation } = args;
  const applyTax = DOC_TYPES[type].hasTax && taxApplies(type, showTaxInQuotation);
  const interState = !!placeOfSupply && !!businessState && placeOfSupply !== businessState;
  const lineCalcs = lines.map((l) => calcLine(l, interState, applyTax));
  const extraCalcs = extras.map((e) => calcExtra(e, interState, applyTax));
  const all = [...lineCalcs, ...extraCalcs];
  const sum = (f: (c: LineCalc) => number) => round2(all.reduce((a, c) => a + f(c), 0));
  const taxable = sum((c) => c.taxable);
  const cgst = sum((c) => c.cgst);
  const sgst = sum((c) => c.sgst);
  const igst = sum((c) => c.igst);
  const raw = round2(taxable + cgst + sgst + igst);
  const total = roundOff ? Math.round(raw) : raw;
  return {
    lineCalcs,
    extraCalcs,
    interState,
    totals: {
      subtotal: sum((c) => c.gross),
      discount: sum((c) => c.discount),
      taxable,
      cgst,
      sgst,
      igst,
      tax: round2(cgst + sgst + igst),
      roundOff: round2(total - raw),
      total,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const nf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtMoney = (n: number): string => nf.format(n || 0);

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerToWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

export function amountInWords(amount: number): string {
  const v = Math.abs(round2(amount));
  const rupees = Math.floor(v);
  const paise = Math.round((v - rupees) * 100);
  let s = `Rupees ${integerToWords(rupees)}`;
  if (paise) s += ` and ${integerToWords(paise)} Paise`;
  return `${s} Only`;
}

/* ------------------------------------------------------------------ */
/* Payment QR                                                          */
/* ------------------------------------------------------------------ */

export function upiUri(args: { vpa: string; name: string; amount?: number; note?: string }): string {
  const q = [`pa=${encodeURIComponent(args.vpa)}`, `pn=${encodeURIComponent(args.name)}`];
  if (args.amount && args.amount > 0) q.push(`am=${args.amount.toFixed(2)}`);
  q.push('cu=INR');
  if (args.note) q.push(`tn=${encodeURIComponent(args.note)}`);
  return `upi://pay?${q.join('&')}`;
}
