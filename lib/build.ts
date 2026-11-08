import type { Business, Doc, DocType, ExtraCharge, LineItem, PartySnapshot, Payment } from './types';
import { DOC_TYPES } from './types';
import { calcDocument } from './gst';

export interface DocInput {
  type: DocType;
  date: string;
  dueDate: string;
  party: PartySnapshot;
  placeOfSupply: string;
  lines: LineItem[];
  extras: ExtraCharge[];
  reverseCharge: boolean;
  notes: string;
  terms: string;
  status: Doc['status'];
  payments: Payment[];
  roundOffEnabled: boolean;
  showTaxInQuotation: boolean;
  convertedFrom?: number;
  refNumber?: string;
  refDate?: string;
  reason?: string;
}

/** Turns form input into a storable document with all totals calculated. */
export function buildDocPayload(input: DocInput, business: Business): Omit<Doc, 'id' | 'number' | 'seq' | 'fy'> {
  // Composition / unregistered businesses can never charge GST.
  const canTax = business.taxScheme === 'regular';
  const effectiveType: DocType = input.type;
  const calc = calcDocument({
    type: effectiveType,
    lines: input.lines,
    extras: input.extras,
    businessState: business.stateCode,
    placeOfSupply: input.placeOfSupply,
    roundOff: input.roundOffEnabled,
    showTaxInQuotation: input.showTaxInQuotation && canTax,
  });
  const now = Date.now();
  return {
    type: effectiveType,
    date: input.date,
    dueDate: input.dueDate,
    party: input.party,
    placeOfSupply: input.placeOfSupply,
    lines: input.lines,
    extras: input.extras,
    reverseCharge: input.reverseCharge,
    notes: input.notes,
    terms: input.terms,
    status: input.status,
    payments: input.payments,
    roundOffEnabled: input.roundOffEnabled,
    showTaxInQuotation: input.showTaxInQuotation && canTax,
    totals: calc.totals,
    lineCalcs: calc.lineCalcs,
    extraCalcs: calc.extraCalcs,
    interState: calc.interState,
    createdAt: now,
    updatedAt: now,
    convertedFrom: input.convertedFrom,
    refNumber: input.refNumber,
    refDate: input.refDate,
    reason: input.reason,
  };
}

export function paidAmount(d: Doc): number {
  return d.payments.reduce((a, p) => a + p.amount, 0);
}

export function balanceDue(d: Doc): number {
  return Math.max(0, Math.round((d.totals.total - paidAmount(d)) * 100) / 100);
}

export function hasTaxColumns(d: Doc): boolean {
  return DOC_TYPES[d.type].hasTax && (d.type !== 'quotation' || d.showTaxInQuotation);
}

/** Status a document should have, given its payments. Cancelled / converted documents keep their status. */
export function statusFor(type: DocType, total: number, payments: Payment[], current?: Doc['status']): Doc['status'] {
  if (current === 'cancelled' || current === 'converted') return current;
  const mode = DOC_TYPES[type].pay;
  if (mode === 'open') return 'draft';
  if (mode === 'settled') return 'paid';
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  if (total <= 0) return 'paid'; // zero-value bill: nothing to collect
  if (paid <= 0) return 'unpaid';
  return paid + 0.004 >= total ? 'paid' : 'partial';
}
