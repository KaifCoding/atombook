import QRCode from 'qrcode';
import type { Business, DesignConfig, Doc } from './types';
import { SHOWS_PAY_INFO } from './types';
import { upiUri } from './gst';
import { balanceDue } from './build';

/** Builds the payment QR (data URL) for a document, or undefined if none applies. */
export async function makePaymentQr(doc: Doc, business: Business): Promise<string | undefined> {
  if (!SHOWS_PAY_INFO.includes(doc.type) || business.qrMode === 'none') return undefined;
  if (business.qrMode === 'custom') return business.customQr || undefined;
  const vpa = business.bank.upiId.trim();
  if (!vpa) return undefined;
  const due = balanceDue(doc);
  const uri = upiUri({
    vpa,
    name: business.bank.accountName || business.name || 'Merchant',
    amount: due > 0 ? due : undefined,
    note: doc.number,
  });
  return QRCode.toDataURL(uri, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
}

export function pdfFileName(doc: Doc): string {
  return `${doc.number.replace(/[\\/:*?"<>|\s]+/g, '-')}.pdf`;
}

export async function renderInvoicePdf(doc: Doc, business: Business, design: DesignConfig): Promise<Blob> {
  const React = await import('react');
  const { pdf } = await import('@react-pdf/renderer');
  const { InvoicePdf, registerPdfFonts } = await import('@/components/pdf/InvoicePdf');
  registerPdfFonts();
  const qr = await makePaymentQr(doc, business);
  const element = React.createElement(InvoicePdf, { doc, business, design, qr });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pdf(element as any).toBlob();
}
