import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToFile } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { InvoicePdf, registerPdfFonts } from '../components/pdf/InvoicePdf';
import { buildDocPayload } from '../lib/build';
import { defaultBusiness, defaultDesign } from '../lib/defaults';
import { gstinChecksum, upiUri } from '../lib/gst';
import type { Doc, DocType, TemplateId } from '../lib/types';

const out = process.argv[2] || '/tmp/pdf-out';
fs.mkdirSync(out, { recursive: true });
registerPdfFonts(path.resolve('public/fonts'));

// tiny 1x1-ish PNGs as stand-ins for logo/signature/seal
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const biz = {
  ...defaultBusiness(),
  name: 'Sharma Electronics', tagline: 'Sales & Service', address: '12, Main Market, Azad Nagar', city: 'Bhilwara', pincode: '311001',
  stateCode: '08', pan: 'AAAAA0000A', email: 'sharma@example.com', phone: '9876543210', logo: png, signature: png, seal: png,
  signatoryName: 'R. Sharma', signatoryDesignation: 'Proprietor',
  bank: { accountName: 'Sharma Electronics', bankName: 'State Bank of India', accountNumber: '123456789012', ifsc: 'SBIN0001234', branch: 'Bhilwara', upiId: 'sharma@sbi' },
};
biz.gstin = '08AAAAA0000A1Z' + gstinChecksum('08AAAAA0000A1Z');

const lines = Array.from({ length: 4 }, (_, i) => ({
  name: `LED TV 43" Model ${i + 1}`, description: i === 0 ? '4K UHD, 1 year warranty' : '', hsn: '85287217', unit: 'NOS', qty: i + 1, rate: 25999.5, discountPct: i === 1 ? 5 : 0, gstRate: 18, taxInclusive: false,
}));

async function main() {
  const types: DocType[] = ['tax_invoice', 'bill_of_supply', 'quotation', 'normal_bill', 'credit_note'];
  const tpls: TemplateId[] = ['classic', 'modern', 'minimal'];
  let n = 0;
  for (const type of types) {
    const tpl = tpls[n % 3];
    const payload = buildDocPayload(
      {
        type, date: '2026-10-31', dueDate: '2026-11-15',
        party: { name: 'Gupta Traders', gstin: '27AAPFU0939F1ZV', address: 'Plot 5, MIDC, Pune', stateCode: '27', phone: '9000000000', email: 'g@example.com' },
        placeOfSupply: n % 2 ? '08' : '27', lines: type === 'bill_of_supply' ? lines.map((l) => ({ ...l, gstRate: 0 })) : lines,
        extras: [{ label: 'Freight', amount: 500, gstRate: 18 }], reverseCharge: false, notes: 'Delivery within 3 days.', terms: biz.defaultTerms,
        status: 'unpaid', payments: n === 0 ? [{ date: '2026-10-31', amount: 10000, mode: 'UPI', ref: '' }] : [], roundOffEnabled: true, showTaxInQuotation: true,
        refNumber: type === 'credit_note' ? 'INV/2627/0001' : undefined, refDate: type === 'credit_note' ? '2026-10-05' : undefined, reason: type === 'credit_note' ? 'Goods returned' : undefined,
      },
      biz,
    );
    const doc: Doc = { ...payload, id: n + 1, seq: n + 1, fy: '2627', number: `${type === 'tax_invoice' ? 'INV' : type.slice(0, 3).toUpperCase()}/2627/000${n + 1}` };
    const design = { ...defaultDesign(), template: tpl, accent: tpl === 'modern' ? '#047857' : '#1d4ed8', tableHeaderBg: tpl === 'modern' ? '#047857' : '#1d4ed8' };
    const qr = type === 'credit_note' ? undefined : await QRCode.toDataURL(upiUri({ vpa: 'sharma@sbi', name: biz.name, amount: 1000 }), { margin: 1, width: 300 });
    await renderToFile(<InvoicePdf doc={doc} business={biz} design={design} qr={qr} />, path.join(out, `${type}-${tpl}.pdf`));
    n++;
  }
  console.log(fs.readdirSync(out).join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
