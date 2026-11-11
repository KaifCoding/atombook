export type DocType =
  | 'tax_invoice'
  | 'bill_of_supply'
  | 'quotation'
  | 'normal_bill'
  | 'credit_note'
  | 'debit_note'
  | 'proforma_invoice'
  | 'delivery_challan'
  | 'purchase_order'
  | 'payment_receipt';

/** How payments work for a document type. track = balance/status follow payments, open = just an open document, settled = always "paid". */
export type PayMode = 'track' | 'open' | 'settled';

export interface DocTypeMeta {
  label: string;
  short: string;
  hasTax: boolean;
  defaultPrefix: string;
  gstReturn: boolean; // goes into GSTR-1 / 3B
  pay: PayMode;
  partyLabel: string; // heading above the party block
  hint: string;
  needsRef: boolean; // refers to an original invoice
  dueLabel: string; // '' = no due date
  sales: boolean; // counts as a sale in dashboard totals
  schemes: TaxScheme[]; // GST schemes that may issue it
}

const ALL: TaxScheme[] = ['regular', 'composition', 'unregistered'];

export const DOC_TYPES: Record<DocType, DocTypeMeta> = {
  tax_invoice: { label: 'Tax Invoice', short: 'Invoice', hasTax: true, defaultPrefix: 'INV/{FY}/', gstReturn: true, pay: 'track', partyLabel: 'Bill To', hint: 'With GST', needsRef: false, dueLabel: 'Due date', sales: true, schemes: ['regular'] },
  bill_of_supply: { label: 'Bill of Supply', short: 'BoS', hasTax: false, defaultPrefix: 'BOS/{FY}/', gstReturn: true, pay: 'track', partyLabel: 'Bill To', hint: 'No GST charged', needsRef: false, dueLabel: 'Due date', sales: true, schemes: ['regular', 'composition'] },
  normal_bill: { label: 'Bill', short: 'Bill', hasTax: false, defaultPrefix: 'BILL/{FY}/', gstReturn: false, pay: 'track', partyLabel: 'Bill To', hint: 'Simple bill', needsRef: false, dueLabel: 'Due date', sales: true, schemes: ALL },
  quotation: { label: 'Quotation', short: 'Quote', hasTax: true, defaultPrefix: 'QT/{FY}/', gstReturn: false, pay: 'open', partyLabel: 'Quotation For', hint: 'Estimate', needsRef: false, dueLabel: 'Valid until', sales: false, schemes: ALL },
  proforma_invoice: { label: 'Proforma Invoice', short: 'Proforma', hasTax: true, defaultPrefix: 'PI/{FY}/', gstReturn: false, pay: 'open', partyLabel: 'Bill To', hint: 'Advance / pre-invoice', needsRef: false, dueLabel: 'Valid until', sales: false, schemes: ['regular'] },
  delivery_challan: { label: 'Delivery Challan', short: 'Challan', hasTax: false, defaultPrefix: 'DC/{FY}/', gstReturn: false, pay: 'open', partyLabel: 'Deliver To', hint: 'Goods movement', needsRef: false, dueLabel: '', sales: false, schemes: ALL },
  purchase_order: { label: 'Purchase Order', short: 'PO', hasTax: false, defaultPrefix: 'PO/{FY}/', gstReturn: false, pay: 'open', partyLabel: 'Vendor', hint: 'Order to a supplier', needsRef: false, dueLabel: 'Delivery by', sales: false, schemes: ALL },
  credit_note: { label: 'Credit Note', short: 'CN', hasTax: true, defaultPrefix: 'CN/{FY}/', gstReturn: true, pay: 'settled', partyLabel: 'Credit To', hint: 'Returns / reductions', needsRef: true, dueLabel: '', sales: true, schemes: ['regular'] },
  debit_note: { label: 'Debit Note', short: 'DN', hasTax: true, defaultPrefix: 'DN/{FY}/', gstReturn: true, pay: 'track', partyLabel: 'Debit To', hint: 'Extra charges on an invoice', needsRef: true, dueLabel: 'Due date', sales: true, schemes: ['regular'] },
  payment_receipt: { label: 'Payment Receipt', short: 'Receipt', hasTax: false, defaultPrefix: 'RCT/{FY}/', gstReturn: false, pay: 'settled', partyLabel: 'Received From', hint: 'Money received', needsRef: false, dueLabel: '', sales: false, schemes: ALL },
};

/** Documents that carry bank details and the payment QR. */
export const SHOWS_PAY_INFO: DocType[] = ['tax_invoice', 'bill_of_supply', 'normal_bill', 'debit_note', 'quotation', 'proforma_invoice'];

export const DOC_TYPE_LIST = Object.keys(DOC_TYPES) as DocType[];

export type TaxScheme = 'regular' | 'composition' | 'unregistered';

export interface NumberingConfig {
  prefix: string; // supports {FY} token, e.g. "INV/{FY}/"
  padding: number; // zero padding of the sequence
  start: number; // first number in a new financial year
}

export interface BankDetails {
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
  upiId: string;
}

export interface Business {
  id: 1;
  updatedAt?: number; // set automatically; used by Drive sync
  name: string;
  tagline: string;
  address: string;
  city: string;
  pincode: string;
  stateCode: string; // 2-digit GST state code
  gstin: string;
  pan: string;
  email: string;
  phone: string;
  website: string;
  taxScheme: TaxScheme;
  logo: string; // data URL
  signature: string; // data URL
  seal: string; // data URL
  signatoryName: string;
  signatoryDesignation: string;
  numbering: Record<DocType, NumberingConfig>;
  bank: BankDetails;
  customQr: string; // data URL of an uploaded QR image (optional)
  qrMode: 'upi' | 'custom' | 'none';
  defaultTerms: string;
  defaultNotes: string;
  b2clThreshold: number; // inter-state B2C invoice value above which invoice-wise reporting is needed
  aggregateTurnoverAbove5Cr: boolean; // decides 4 or 6 digit HSN
  monthlyFiler: boolean; // monthly (true) or QRMP quarterly (false)
}

export interface Customer {
  id?: number;
  updatedAt?: number; // set automatically; used by Drive sync
  name: string;
  gstin: string;
  address: string;
  stateCode: string;
  phone: string;
  email: string;
  createdAt: number;
}

export type ItemKind = 'goods' | 'service';

export interface Item {
  id?: number;
  updatedAt?: number; // set automatically; used by Drive sync
  name: string;
  description: string;
  kind: ItemKind;
  hsn: string; // HSN for goods, SAC for services
  unit: string;
  rate: number;
  gstRate: number; // 0, 0.25, 3, 5, 12, 18, 28
  taxInclusive: boolean;
  createdAt: number;
}

export interface LineItem {
  itemId?: number;
  name: string;
  description: string;
  hsn: string;
  unit: string;
  qty: number;
  rate: number;
  discountPct: number;
  gstRate: number;
  taxInclusive: boolean;
}

export interface ExtraCharge {
  label: string;
  amount: number;
  gstRate: number;
}

export type DocStatus = 'draft' | 'unpaid' | 'partial' | 'paid' | 'cancelled' | 'converted';

export interface PartySnapshot {
  customerId?: number;
  name: string;
  gstin: string;
  address: string;
  stateCode: string;
  phone: string;
  email: string;
}

export interface Payment {
  date: string; // yyyy-mm-dd
  amount: number;
  mode: string;
  ref: string;
}

export interface Totals {
  subtotal: number; // sum of qty*rate (before discount, tax-exclusive basis)
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  roundOff: number;
  total: number;
}

export interface LineCalc {
  gross: number;
  discount: number;
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface Doc {
  id?: number;
  type: DocType;
  number: string;
  seq: number;
  fy: string; // e.g. 2526
  date: string; // yyyy-mm-dd
  dueDate: string;
  party: PartySnapshot;
  placeOfSupply: string; // state code
  lines: LineItem[];
  extras: ExtraCharge[];
  reverseCharge: boolean;
  notes: string;
  terms: string;
  status: DocStatus;
  payments: Payment[];
  roundOffEnabled: boolean;
  showTaxInQuotation: boolean;
  totals: Totals;
  lineCalcs: LineCalc[];
  extraCalcs: LineCalc[];
  interState: boolean;
  createdAt: number;
  updatedAt: number;
  convertedFrom?: number;
  refNumber?: string; // credit note: original invoice number
  refDate?: string; // credit note: original invoice date
  reason?: string; // credit note reason
}

export type TemplateId = 'classic' | 'modern' | 'minimal';

export interface DesignConfig {
  id: 1;
  updatedAt?: number; // set automatically; used by Drive sync
  template: TemplateId;
  accent: string;
  fontFamily: 'NotoSans' | 'Helvetica' | 'Times-Roman';
  fontSize: number;
  paper: 'A4' | 'A5' | 'LETTER';
  logoPosition: 'left' | 'center' | 'right';
  logoSize: number;
  showLogo: boolean;
  showTagline: boolean;
  showGstin: boolean;
  showHsn: boolean;
  showUnit: boolean;
  showDiscount: boolean;
  showGstRate: boolean;
  showSerial: boolean;
  showAmountInWords: boolean;
  showBank: boolean;
  showQr: boolean;
  showSignature: boolean;
  showSeal: boolean;
  sealPosition: 'right' | 'left' | 'center';
  sealSize: number;
  signatureSize: number;
  showTerms: boolean;
  showNotes: boolean;
  showTaxSummary: boolean;
  showPlaceOfSupply: boolean;
  showPageNumbers: boolean;
  headerNote: string;
  footerText: string;
  labels: {
    tax_invoice: string;
    bill_of_supply: string;
    quotation: string;
    normal_bill: string;
    credit_note: string;
    debit_note: string;
    proforma_invoice: string;
    delivery_challan: string;
    purchase_order: string;
    payment_receipt: string;
    billTo: string;
    signatory: string;
    thanks: string;
  };
  tableHeaderBg: string;
  tableHeaderText: string;
  zebra: boolean;
  watermark: string;
}
