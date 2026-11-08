import { loadBusiness, loadDesign } from './db';
import { pdfFileName, renderInvoicePdf } from './pdf';
import { saveBlob } from './files';
import type { Doc } from './types';

export async function buildPdfBlob(doc: Doc): Promise<Blob> {
  const [business, design] = await Promise.all([loadBusiness(), loadDesign()]);
  return renderInvoicePdf(doc, business, design);
}

export async function downloadDocPdf(doc: Doc): Promise<void> {
  const blob = await buildPdfBlob(doc);
  await saveBlob(blob, pdfFileName(doc));
}
