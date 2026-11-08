import React from 'react';
import { Document, Font, Image, Page, Text, View } from '@react-pdf/renderer';
import type { Business, DesignConfig, Doc, LineCalc } from '@/lib/types';
import { DOC_TYPES, SHOWS_PAY_INFO } from '@/lib/types';
import { amountInWords, fmtDate, fmtMoney } from '@/lib/gst';
import { stateLabel } from '@/lib/states';
import { balanceDue, hasTaxColumns, paidAmount } from '@/lib/build';

let registered = false;
export function registerPdfFonts(dir = '/fonts'): void {
  if (registered) return;
  Font.register({
    family: 'NotoSans',
    fonts: [
      { src: `${dir}/NotoSans-Regular.ttf`, fontWeight: 400 },
      { src: `${dir}/NotoSans-Bold.ttf`, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((w) => [w]);
  registered = true;
}

const fonts = (family: DesignConfig['fontFamily']) => {
  if (family === 'Times-Roman') return { reg: 'Times-Roman', bold: 'Times-Bold' };
  if (family === 'Helvetica') return { reg: 'Helvetica', bold: 'Helvetica-Bold' };
  return { reg: 'NotoSans', bold: 'NotoSans' };
};

interface Props {
  doc: Doc;
  business: Business;
  design: DesignConfig;
  qr?: string; // data URL of the payment QR
}

interface Col {
  key: string;
  label: string;
  w: number;
  align: 'left' | 'right' | 'center';
}

export function InvoicePdf({ doc, business, design, qr }: Props) {
  const f = fonts(design.fontFamily);
  const sym = design.fontFamily === 'NotoSans' ? '₹' : 'Rs.';
  const money = (n: number) => fmtMoney(n);
  const fs = design.fontSize;
  const accent = design.accent;
  const taxed = hasTaxColumns(doc);
  const tpl = design.template;
  const B = { fontFamily: f.bold, fontWeight: 700 as const };
  const muted = '#555555';
  const line = '#d1d5db';

  /* ------- columns ------- */
  const cols: Col[] = [];
  if (design.showSerial) cols.push({ key: 'sn', label: '#', w: 4, align: 'center' });
  cols.push({ key: 'item', label: 'Item / Description', w: 28, align: 'left' });
  if (design.showHsn) cols.push({ key: 'hsn', label: 'HSN/SAC', w: 9, align: 'left' });
  cols.push({ key: 'qty', label: 'Qty', w: 7, align: 'right' });
  if (design.showUnit) cols.push({ key: 'unit', label: 'Unit', w: 6, align: 'left' });
  cols.push({ key: 'rate', label: `Rate (${sym})`, w: 11, align: 'right' });
  if (design.showDiscount) cols.push({ key: 'disc', label: 'Disc %', w: 7, align: 'right' });
  if (taxed && design.showGstRate) cols.push({ key: 'gst', label: 'GST %', w: 7, align: 'right' });
  if (taxed) cols.push({ key: 'taxable', label: `Taxable (${sym})`, w: 12, align: 'right' });
  cols.push({ key: 'amount', label: `Amount (${sym})`, w: 12, align: 'right' });
  const totalW = cols.reduce((a, c) => a + c.w, 0);
  const width = (c: Col) => `${(c.w / totalW) * 100}%`;

  const cell = (key: string, i: number): string => {
    const l = doc.lines[i];
    const c = doc.lineCalcs[i];
    switch (key) {
      case 'sn': return String(i + 1);
      case 'hsn': return l.hsn;
      case 'qty': return String(l.qty);
      case 'unit': return l.unit;
      case 'rate': return money(l.rate);
      case 'disc': return l.discountPct ? String(l.discountPct) : '-';
      case 'gst': return String(c.gstRate);
      case 'taxable': return money(c.taxable);
      case 'amount': return money(taxed ? c.total : c.taxable);
      default: return '';
    }
  };

  /* ------- totals ------- */
  const lineGross = doc.lineCalcs.reduce((a, c) => a + c.gross, 0);
  const lineDisc = doc.lineCalcs.reduce((a, c) => a + c.discount, 0);
  const extrasAmt = (doc.extraCalcs || []).reduce((a, c) => a + c.taxable, 0);
  const t = doc.totals;

  const allCalcs: LineCalc[] = [...doc.lineCalcs, ...(doc.extraCalcs || [])];
  const byRate = new Map<number, { rt: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  allCalcs.forEach((c) => {
    const e = byRate.get(c.gstRate) || { rt: c.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    e.taxable += c.taxable; e.cgst += c.cgst; e.sgst += c.sgst; e.igst += c.igst;
    byRate.set(c.gstRate, e);
  });
  const rateRows = [...byRate.values()].sort((a, b) => a.rt - b.rt);

  const paid = paidAmount(doc);
  const due = balanceDue(doc);
  const title = design.labels[doc.type];
  const showBankBox = design.showBank && SHOWS_PAY_INFO.includes(doc.type) && !!(business.bank.accountNumber || business.bank.upiId);
  const showQrBox = design.showQr && !!qr && SHOWS_PAY_INFO.includes(doc.type);
  const isCompositionBoS = business.taxScheme === 'composition' && doc.type === 'bill_of_supply';

  const addressLines = [
    business.address,
    [business.city, business.pincode].filter(Boolean).join(' - '),
    business.stateCode ? stateLabel(business.stateCode) : '',
  ].filter(Boolean);

  /* ------- header pieces ------- */
  const bandHeader = tpl === 'modern';
  const headFg = bandHeader ? '#ffffff' : '#111111';
  const logo =
    design.showLogo && business.logo ? (
      <Image src={business.logo} style={{ width: design.logoSize, height: design.logoSize, objectFit: 'contain' }} />
    ) : null;

  const businessBlock = (
    <View style={{ flex: 1, alignItems: design.logoPosition === 'center' ? 'center' : design.logoPosition === 'right' ? 'flex-end' : 'flex-start' }}>
      <Text style={{ ...B, fontSize: fs + 6, color: bandHeader ? '#fff' : accent }}>{business.name || 'Your Business Name'}</Text>
      {design.showTagline && !!business.tagline && <Text style={{ fontSize: fs, color: bandHeader ? '#e5e7eb' : muted }}>{business.tagline}</Text>}
      {addressLines.map((l, i) => (
        <Text key={i} style={{ fontSize: fs, color: headFg }}>{l}</Text>
      ))}
      {design.showGstin && !!business.gstin && business.taxScheme !== 'unregistered' && (
        <Text style={{ fontSize: fs, color: headFg }}><Text style={B}>GSTIN: </Text>{business.gstin}</Text>
      )}
      {!!business.pan && <Text style={{ fontSize: fs, color: headFg }}>PAN: {business.pan}</Text>}
      {!!(business.phone || business.email) && (
        <Text style={{ fontSize: fs, color: headFg }}>{[business.phone && `Ph: ${business.phone}`, business.email].filter(Boolean).join('  |  ')}</Text>
      )}
      {!!business.website && <Text style={{ fontSize: fs, color: headFg }}>{business.website}</Text>}
    </View>
  );

  const header = (
    <View
      style={{
        flexDirection: design.logoPosition === 'right' ? 'row-reverse' : 'row',
        alignItems: 'center',
        gap: 10,
        padding: bandHeader ? 12 : 0,
        backgroundColor: bandHeader ? accent : undefined,
        marginBottom: 8,
        borderBottomWidth: tpl === 'classic' ? 1.5 : 0,
        borderBottomColor: accent,
        paddingBottom: tpl === 'classic' ? 8 : bandHeader ? 12 : 0,
      }}
    >
      {design.logoPosition !== 'center' && logo}
      {design.logoPosition === 'center' ? (
        <View style={{ flex: 1, alignItems: 'center' }}>
          {logo}
          {businessBlock}
        </View>
      ) : (
        businessBlock
      )}
    </View>
  );

  /* ------- document title bar ------- */
  const meta: [string, string][] = [
    [`${DOC_TYPES[doc.type].short} No.`, doc.number],
    ['Date', fmtDate(doc.date)],
  ];
  const dueLabel = DOC_TYPES[doc.type].dueLabel;
  if (doc.dueDate && dueLabel) meta.push([dueLabel === 'Due date' ? 'Due Date' : dueLabel === 'Valid until' ? 'Valid Until' : dueLabel, fmtDate(doc.dueDate)]);
  if (doc.refNumber) meta.push(['Against Invoice', doc.refNumber]);
  if (doc.refDate) meta.push(['Invoice Date', fmtDate(doc.refDate)]);
  if (design.showPlaceOfSupply && doc.placeOfSupply && DOC_TYPES[doc.type].hasTax) meta.push(['Place of Supply', stateLabel(doc.placeOfSupply)]);
  if (doc.type === 'tax_invoice') meta.push(['Reverse Charge', doc.reverseCharge ? 'Yes' : 'No']);

  const titleBar = (
    <View
      style={{
        backgroundColor: tpl === 'minimal' ? undefined : tpl === 'modern' ? '#f3f4f6' : accent,
        borderBottomWidth: tpl === 'minimal' ? 1 : 0,
        borderBottomColor: accent,
        paddingVertical: 4,
        marginBottom: 8,
        alignItems: 'center',
      }}
    >
      <Text style={{ ...B, fontSize: fs + 4, letterSpacing: 1, color: tpl === 'classic' ? '#ffffff' : accent }}>{title}</Text>
    </View>
  );

  const partyAndMeta = (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
      <View style={{ flex: 1.2, borderWidth: tpl === 'minimal' ? 0 : 1, borderColor: line, padding: 6 }}>
        <Text style={{ ...B, fontSize: fs - 1, color: accent, marginBottom: 2 }}>{(['tax_invoice', 'bill_of_supply', 'normal_bill'].includes(doc.type) ? design.labels.billTo : DOC_TYPES[doc.type].partyLabel).toUpperCase()}</Text>
        <Text style={{ ...B, fontSize: fs + 1 }}>{doc.party.name || 'Walk-in Customer'}</Text>
        {!!doc.party.address && <Text style={{ fontSize: fs }}>{doc.party.address}</Text>}
        {!!doc.party.stateCode && <Text style={{ fontSize: fs }}>State: {stateLabel(doc.party.stateCode)}</Text>}
        {!!doc.party.gstin && <Text style={{ fontSize: fs }}><Text style={B}>GSTIN: </Text>{doc.party.gstin}</Text>}
        {!!doc.party.phone && <Text style={{ fontSize: fs }}>Ph: {doc.party.phone}</Text>}
        {!!doc.party.email && <Text style={{ fontSize: fs }}>{doc.party.email}</Text>}
      </View>
      <View style={{ flex: 1, borderWidth: tpl === 'minimal' ? 0 : 1, borderColor: line, padding: 6 }}>
        {meta.map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', marginBottom: 1.5 }}>
            <Text style={{ ...B, fontSize: fs, width: '42%' }}>{k}</Text>
            <Text style={{ fontSize: fs, width: '58%' }}>{v}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  /* ------- items table ------- */
  const headBg = tpl === 'minimal' ? undefined : design.tableHeaderBg;
  const headFgCol = tpl === 'minimal' ? '#111111' : design.tableHeaderText;
  const table = (
    <View style={{ marginBottom: 6, borderWidth: 1, borderColor: line }}>
      <View
        fixed
        style={{
          flexDirection: 'row',
          backgroundColor: headBg,
          borderBottomWidth: tpl === 'minimal' ? 1 : 0,
          borderBottomColor: accent,
        }}
      >
        {cols.map((c) => (
          <Text key={c.key} style={{ ...B, width: width(c), fontSize: fs - 0.5, padding: 4, textAlign: c.align, color: headFgCol }}>
            {c.label}
          </Text>
        ))}
      </View>
      {doc.lines.map((l, i) => (
        <View
          key={i}
          wrap={false}
          style={{
            flexDirection: 'row',
            backgroundColor: design.zebra && i % 2 === 1 ? '#f5f7fa' : undefined,
            borderTopWidth: 0.5,
            borderTopColor: line,
          }}
        >
          {cols.map((c) =>
            c.key === 'item' ? (
              <View key={c.key} style={{ width: width(c), padding: 4 }}>
                <Text style={{ fontSize: fs, ...B }}>{l.name}</Text>
                {!!l.description && <Text style={{ fontSize: fs - 1, color: muted }}>{l.description}</Text>}
              </View>
            ) : (
              <Text key={c.key} style={{ width: width(c), fontSize: fs, padding: 4, textAlign: c.align }}>
                {cell(c.key, i)}
              </Text>
            ),
          )}
        </View>
      ))}
    </View>
  );

  /* ------- totals ------- */
  const tRow = (label: string, value: string, strong = false) => (
    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 }}>
      <Text style={{ fontSize: strong ? fs + 1 : fs, ...(strong ? B : {}) }}>{label}</Text>
      <Text style={{ fontSize: strong ? fs + 1 : fs, ...(strong ? B : {}) }}>{value}</Text>
    </View>
  );

  const totalsBox = (
    <View style={{ flex: 1 }}>
      {tRow(taxed ? 'Sub Total (excl. tax)' : 'Sub Total', `${sym} ${money(lineGross)}`)}
      {lineDisc > 0 && tRow('Discount', `- ${sym} ${money(lineDisc)}`)}
      {(doc.extras || []).map((e, i) => tRow(e.label || 'Additional charge', `${sym} ${money(doc.extraCalcs?.[i]?.taxable ?? e.amount)}`))}
      {taxed && (
        <>
          {tRow('Taxable Value', `${sym} ${money(t.taxable)}`)}
          {t.cgst > 0 && tRow('CGST', `${sym} ${money(t.cgst)}`)}
          {t.sgst > 0 && tRow('SGST / UTGST', `${sym} ${money(t.sgst)}`)}
          {t.igst > 0 && tRow('IGST', `${sym} ${money(t.igst)}`)}
        </>
      )}
      {t.roundOff !== 0 && tRow('Round Off', `${t.roundOff > 0 ? '+' : '-'} ${money(Math.abs(t.roundOff))}`)}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 3,
          paddingVertical: 4,
          paddingHorizontal: 4,
          backgroundColor: tpl === 'minimal' ? undefined : accent,
          borderTopWidth: tpl === 'minimal' ? 1 : 0,
          borderTopColor: accent,
        }}
      >
        <Text style={{ ...B, fontSize: fs + 2, color: tpl === 'minimal' ? '#111' : '#fff' }}>{doc.type === 'credit_note' ? 'Credit Total' : doc.type === 'payment_receipt' ? 'Amount Received' : 'Grand Total'}</Text>
        <Text style={{ ...B, fontSize: fs + 2, color: tpl === 'minimal' ? '#111' : '#fff' }}>{sym} {money(t.total)}</Text>
      </View>
      {DOC_TYPES[doc.type].pay === 'track' && paid > 0 && tRow('Paid', `${sym} ${money(paid)}`)}
      {DOC_TYPES[doc.type].pay === 'track' && paid > 0 && tRow('Balance Due', `${sym} ${money(due)}`, true)}
    </View>
  );

  const taxSummary =
    taxed && design.showTaxSummary && rateRows.some((r) => r.rt > 0) ? (
      <View style={{ flex: 1.2 }}>
        <Text style={{ ...B, fontSize: fs - 0.5, color: accent, marginBottom: 2 }}>TAX SUMMARY</Text>
        <View style={{ borderWidth: 0.5, borderColor: line }}>
          <View style={{ flexDirection: 'row', backgroundColor: '#f3f4f6' }}>
            {['Rate', 'Taxable', doc.interState ? 'IGST' : 'CGST', ...(doc.interState ? [] : ['SGST'])].map((h, i) => (
              <Text key={h} style={{ ...B, fontSize: fs - 1, padding: 2, flex: 1, textAlign: i === 0 ? 'left' : 'right' }}>{h}</Text>
            ))}
          </View>
          {rateRows.map((r) => (
            <View key={r.rt} style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: line }}>
              <Text style={{ fontSize: fs - 1, padding: 2, flex: 1 }}>{r.rt}%</Text>
              <Text style={{ fontSize: fs - 1, padding: 2, flex: 1, textAlign: 'right' }}>{money(r.taxable)}</Text>
              {doc.interState ? (
                <Text style={{ fontSize: fs - 1, padding: 2, flex: 1, textAlign: 'right' }}>{money(r.igst)}</Text>
              ) : (
                <>
                  <Text style={{ fontSize: fs - 1, padding: 2, flex: 1, textAlign: 'right' }}>{money(r.cgst)}</Text>
                  <Text style={{ fontSize: fs - 1, padding: 2, flex: 1, textAlign: 'right' }}>{money(r.sgst)}</Text>
                </>
              )}
            </View>
          ))}
        </View>
      </View>
    ) : null;

  /* ------- bank / QR / terms / signature ------- */
  const b = business.bank;
  const bankBox = showBankBox ? (
    <View style={{ flex: 1, borderWidth: tpl === 'minimal' ? 0 : 1, borderColor: line, padding: 6 }}>
      <Text style={{ ...B, fontSize: fs - 0.5, color: accent, marginBottom: 2 }}>BANK DETAILS</Text>
      {([
        ['A/c Name', b.accountName || business.name],
        ['Bank', b.bankName],
        ['A/c No.', b.accountNumber],
        ['IFSC', b.ifsc],
        ['Branch', b.branch],
        ['UPI', b.upiId],
      ] as [string, string][])
        .filter(([, v]) => !!v)
        .map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row' }}>
            <Text style={{ ...B, fontSize: fs - 0.5, width: '28%' }}>{k}</Text>
            <Text style={{ fontSize: fs - 0.5, width: '72%' }}>{v}</Text>
          </View>
        ))}
    </View>
  ) : null;

  const qrBox = showQrBox ? (
    <View style={{ width: 92, alignItems: 'center', borderWidth: tpl === 'minimal' ? 0 : 1, borderColor: line, padding: 4 }}>
      <Image src={qr!} style={{ width: 76, height: 76 }} />
      <Text style={{ fontSize: fs - 1.5, marginTop: 2 }}>Scan to pay</Text>
    </View>
  ) : null;

  const sigH = Math.max(48, Math.round(design.signatureSize / 2) + 8);
  const sealSize = design.sealSize || 78;
  const showSeal = design.showSeal && !!business.seal;
  const signature = (
    <View style={{ width: 170, alignItems: 'center' }}>
      <Text style={{ fontSize: fs }}>{design.labels.signatory} <Text style={B}>{business.name}</Text></Text>
      <View style={{ height: sigH, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
        {showSeal && design.sealPosition === 'center' && (
          <Image src={business.seal} style={{ position: 'absolute', width: sealSize, height: sealSize, objectFit: 'contain', opacity: 0.85 }} />
        )}
        {design.showSignature && !!business.signature && (
          <Image src={business.signature} style={{ width: design.signatureSize, height: design.signatureSize / 2, objectFit: 'contain' }} />
        )}
      </View>
      <View style={{ borderTopWidth: 0.7, borderTopColor: '#111', width: '100%', alignItems: 'center', paddingTop: 2 }}>
        {!!business.signatoryName && <Text style={{ ...B, fontSize: fs }}>{business.signatoryName}</Text>}
        <Text style={{ fontSize: fs - 0.5, color: muted }}>{business.signatoryDesignation || 'Authorised Signatory'}</Text>
      </View>
    </View>
  );
  const sealImg =
    showSeal && design.sealPosition !== 'center' ? (
      <Image src={business.seal} style={{ width: sealSize, height: sealSize, objectFit: 'contain' }} />
    ) : null;

  const size = design.paper === 'LETTER' ? 'LETTER' : design.paper;

  return (
    <Document title={`${title} ${doc.number}`} author={business.name} creator="Atombook">
      <Page size={size} style={{ padding: 24, paddingBottom: 38, fontFamily: f.reg, fontSize: fs, color: '#111111' }}>
        {(design.watermark || doc.status === 'cancelled') && (
          <Text
            fixed
            style={{ position: 'absolute', top: 280, left: 60, fontSize: 72, color: doc.status === 'cancelled' ? '#dc2626' : '#9ca3af', opacity: 0.12, transform: 'rotate(-30deg)', ...B }}
          >
            {doc.status === 'cancelled' ? 'CANCELLED' : design.watermark}
          </Text>
        )}

        {header}
        {titleBar}
        {!!design.headerNote && <Text style={{ fontSize: fs, marginBottom: 6 }}>{design.headerNote}</Text>}
        {partyAndMeta}
        {table}

        <View wrap={false} style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <View style={{ flex: 1.15, gap: 6 }}>
            {taxSummary}
            {design.showAmountInWords && (
              <View>
                <Text style={{ ...B, fontSize: fs - 0.5, color: accent }}>AMOUNT IN WORDS</Text>
                <Text style={{ fontSize: fs }}>{amountInWords(t.total)}</Text>
              </View>
            )}
          </View>
          {totalsBox}
        </View>

        <View wrap={false} style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
          {bankBox || <View style={{ flex: 1 }} />}
          {qrBox}
          {design.sealPosition === 'left' && sealImg}
          {signature}
          {design.sealPosition === 'right' && sealImg}
        </View>

        {isCompositionBoS && (
          <Text style={{ fontSize: fs, marginTop: 6, ...B }}>Composition taxable person, not eligible to collect tax on supplies.</Text>
        )}

        {!!doc.reason && (
          <Text style={{ fontSize: fs, marginTop: 6 }}><Text style={B}>Reason: </Text>{doc.reason}</Text>
        )}

        {design.showNotes && !!doc.notes && (
          <View wrap={false} style={{ marginTop: 8 }}>
            <Text style={{ ...B, fontSize: fs - 0.5, color: accent }}>NOTES</Text>
            <Text style={{ fontSize: fs }}>{doc.notes}</Text>
          </View>
        )}
        {design.showTerms && !!doc.terms && (
          <View wrap={false} style={{ marginTop: 6 }}>
            <Text style={{ ...B, fontSize: fs - 0.5, color: accent }}>TERMS &amp; CONDITIONS</Text>
            <Text style={{ fontSize: fs - 0.5, color: muted }}>{doc.terms}</Text>
          </View>
        )}

        {!!design.labels.thanks && (
          <Text style={{ textAlign: 'center', marginTop: 8, fontSize: fs, color: accent, ...B }}>{design.labels.thanks}</Text>
        )}

        <View fixed style={{ position: 'absolute', bottom: 16, left: 24, right: 24, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: fs - 2, color: '#6b7280' }}>{design.footerText}</Text>
          {design.showPageNumbers && (
            <Text style={{ fontSize: fs - 2, color: '#6b7280' }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          )}
        </View>
      </Page>
    </Document>
  );
}
