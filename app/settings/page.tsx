'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Save, Upload } from 'lucide-react';
import { Field, ImageUpload, PageHeader, StateSelect, toast } from '@/components/ui';
import { exportBackup, formatNumber, importBackup, saveBusiness, type BackupFile } from '@/lib/db';
import { useBusiness } from '@/lib/hooks';
import { fyCode, isValidGstin, stateFromGstin, todayStr, upiUri } from '@/lib/gst';
import { saveJson } from '@/lib/files';
import { DOC_TYPES, type Business, type DocType } from '@/lib/types';

const TYPES = Object.keys(DOC_TYPES) as DocType[];

export default function SettingsPage() {
  const saved = useBusiness();
  const [b, setB] = useState<Business | null>(null);
  const [upiQr, setUpiQr] = useState('');
  const [dirty, setDirty] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saved && !b) setB(saved);
  }, [saved, b]);

  useEffect(() => {
    if (!b || !b.bank.upiId) return setUpiQr('');
    QRCode.toDataURL(upiUri({ vpa: b.bank.upiId, name: b.bank.accountName || b.name || 'Merchant' }), { margin: 1, width: 200 }).then(setUpiQr);
  }, [b?.bank.upiId, b?.bank.accountName, b?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b) return <div className="text-sm text-gray-500">Loading…</div>;

  const set = <K extends keyof Business>(k: K, v: Business[K]) => {
    setB((p) => (p ? { ...p, [k]: v } : p));
    setDirty(true);
  };
  const setBank = (k: keyof Business['bank'], v: string) => {
    setB((p) => (p ? { ...p, bank: { ...p.bank, [k]: v } } : p));
    setDirty(true);
  };
  const setNum = (t: DocType, k: 'prefix' | 'padding' | 'start', v: string | number) => {
    setB((p) => (p ? { ...p, numbering: { ...p.numbering, [t]: { ...p.numbering[t], [k]: v } } } : p));
    setDirty(true);
  };

  const gstinOk = !b.gstin || isValidGstin(b.gstin);
  const needsGstin = b.taxScheme !== 'unregistered';

  const save = async () => {
    if (!b.name.trim()) return toast('Enter your business name', 'error');
    if (needsGstin && !b.gstin) return toast('Enter your GSTIN (or choose "Unregistered" as tax scheme)', 'error');
    if (b.gstin && !isValidGstin(b.gstin)) return toast('GSTIN is not valid. Please check it.', 'error');
    if (!b.stateCode) return toast('Select your state', 'error');
    for (const t of TYPES) {
      const n = b.numbering[t];
      if (formatNumber(n, '2627', 9999).length > 16 && DOC_TYPES[t].gstReturn)
        return toast(`${DOC_TYPES[t].label}: the number can be at most 16 characters (GST rule). Shorten the prefix.`, 'error');
    }
    await saveBusiness({ ...b, gstin: b.gstin.trim().toUpperCase() });
    setDirty(false);
    toast('Business settings saved');
  };

  const doBackup = async () => {
    const data = await exportBackup();
    await saveJson(data, `atombook-backup-${todayStr()}.json`);
    toast('Backup file created');
  };

  const doRestore = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as BackupFile;
      if (!window.confirm('Restoring replaces ALL data on this device with the backup. Continue?')) return;
      await importBackup(data);
      setB(null);
      toast('Backup restored');
    } catch (e) {
      toast((e as Error).message || 'Could not restore this file', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Business Setup"
        subtitle="These details appear on every document you create."
        actions={
          <button className="btn-primary" onClick={save} disabled={!dirty && !!saved?.name}>
            <Save size={16} /> Save
          </button>
        }
      />

      <section className="card">
        <h2 className="mb-3 font-semibold">Business details</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Business name *"><input className="input" value={b.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Tagline"><input className="input" value={b.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="e.g. Sales & Service" /></Field>
          <Field label="Address" className="md:col-span-2"><textarea className="input" rows={2} value={b.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="City"><input className="input" value={b.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label="Pincode"><input className="input" inputMode="numeric" maxLength={6} value={b.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="State *"><StateSelect value={b.stateCode} onChange={(v) => set('stateCode', v)} /></Field>
          <Field label="Phone"><input className="input" inputMode="tel" value={b.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={b.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Website"><input className="input" value={b.website} onChange={(e) => set('website', e.target.value)} /></Field>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Tax registration</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="GST scheme" hint="Composition and unregistered businesses cannot issue Tax Invoices; they use Bill of Supply.">
            <select className="input" value={b.taxScheme} onChange={(e) => set('taxScheme', e.target.value as Business['taxScheme'])}>
              <option value="regular">Regular taxpayer</option>
              <option value="composition">Composition scheme</option>
              <option value="unregistered">Not registered under GST</option>
            </select>
          </Field>
          <Field label={`GSTIN${needsGstin ? ' *' : ''}`} error={!gstinOk ? 'Invalid GSTIN (format or check digit is wrong)' : undefined}>
            <input
              className="input uppercase"
              maxLength={15}
              value={b.gstin}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
                set('gstin', v);
                if (isValidGstin(v)) set('stateCode', stateFromGstin(v));
              }}
            />
          </Field>
          <Field label="PAN"><input className="input uppercase" maxLength={10} value={b.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></Field>
          <Field label="GST filing frequency">
            <select className="input" value={b.monthlyFiler ? 'm' : 'q'} onChange={(e) => set('monthlyFiler', e.target.value === 'm')}>
              <option value="m">Monthly</option>
              <option value="q">Quarterly (QRMP)</option>
            </select>
          </Field>
          <Field label="Annual turnover" hint="Decides whether 4-digit or 6-digit HSN codes are needed in GSTR-1.">
            <select className="input" value={b.aggregateTurnoverAbove5Cr ? 'y' : 'n'} onChange={(e) => set('aggregateTurnoverAbove5Cr', e.target.value === 'y')}>
              <option value="n">Up to ₹5 crore (4-digit HSN)</option>
              <option value="y">Above ₹5 crore (6-digit HSN)</option>
            </select>
          </Field>
          <Field label="B2C large invoice limit (₹)" hint="Inter-state sales to unregistered buyers above this are reported invoice-wise (₹1,00,000 from Aug 2024).">
            <input className="input" type="number" min={0} value={b.b2clThreshold} onChange={(e) => set('b2clThreshold', Number(e.target.value))} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Logo, signature &amp; seal</h2>
        <div className="grid gap-5 md:grid-cols-3">
          <ImageUpload label="Logo" value={b.logo} onChange={(v) => set('logo', v)} maxSize={500} />
          <ImageUpload label="Signature" value={b.signature} onChange={(v) => set('signature', v)} hint="Transparent PNG looks best." maxSize={500} />
          <ImageUpload label="Seal / Stamp" value={b.seal} onChange={(v) => set('seal', v)} maxSize={400} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Signatory name"><input className="input" value={b.signatoryName} onChange={(e) => set('signatoryName', e.target.value)} /></Field>
          <Field label="Designation"><input className="input" value={b.signatoryDesignation} onChange={(e) => set('signatoryDesignation', e.target.value)} placeholder="Proprietor / Director / Authorised Signatory" /></Field>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-1 font-semibold">Document numbering</h2>
        <p className="mb-3 text-xs text-gray-500">
          Use <code className="rounded bg-gray-100 px-1">{'{FY}'}</code> in the prefix to insert the financial year (e.g. 2627) and restart numbering each April. GST allows at most 16 characters.
        </p>
        <div className="space-y-2">
          {TYPES.map((t) => {
            const n = b.numbering[t];
            const preview = formatNumber(n, fyCode(todayStr()), n.start);
            return (
              <div key={t} className="grid items-end gap-2 md:grid-cols-[150px_1fr_90px_90px_1fr]">
                <div className="text-sm font-medium">{DOC_TYPES[t].label}</div>
                <Field label="Prefix"><input className="input" value={n.prefix} onChange={(e) => setNum(t, 'prefix', e.target.value)} /></Field>
                <Field label="Digits"><input className="input" type="number" min={1} max={8} value={n.padding} onChange={(e) => setNum(t, 'padding', Math.max(1, Math.min(8, Number(e.target.value))))} /></Field>
                <Field label="Start at"><input className="input" type="number" min={1} value={n.start} onChange={(e) => setNum(t, 'start', Math.max(1, Number(e.target.value)))} /></Field>
                <div className="text-sm text-gray-500">
                  Next: <span className={`font-mono font-semibold ${preview.length > 16 && DOC_TYPES[t].gstReturn ? 'text-red-600' : 'text-gray-800'}`}>{preview}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Bank details &amp; payment QR</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Account holder name"><input className="input" value={b.bank.accountName} onChange={(e) => setBank('accountName', e.target.value)} /></Field>
          <Field label="Bank name"><input className="input" value={b.bank.bankName} onChange={(e) => setBank('bankName', e.target.value)} /></Field>
          <Field label="Account number"><input className="input" inputMode="numeric" value={b.bank.accountNumber} onChange={(e) => setBank('accountNumber', e.target.value)} /></Field>
          <Field label="IFSC"><input className="input uppercase" value={b.bank.ifsc} onChange={(e) => setBank('ifsc', e.target.value.toUpperCase())} /></Field>
          <Field label="Branch"><input className="input" value={b.bank.branch} onChange={(e) => setBank('branch', e.target.value)} /></Field>
          <Field label="UPI ID" hint="e.g. shopname@sbi"><input className="input" value={b.bank.upiId} onChange={(e) => setBank('upiId', e.target.value.trim())} /></Field>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Payment QR on documents">
            <select className="input" value={b.qrMode} onChange={(e) => set('qrMode', e.target.value as Business['qrMode'])}>
              <option value="upi">Auto-generate UPI QR (includes the amount due)</option>
              <option value="custom">Use my own QR image</option>
              <option value="none">No QR</option>
            </select>
          </Field>
          {b.qrMode === 'custom' && <ImageUpload label="Your QR image" value={b.customQr} onChange={(v) => set('customQr', v)} hint="Upload a QR from your bank / payment app." maxSize={700} />}
          {b.qrMode === 'upi' && (
            <div className="flex items-center gap-3">
              {upiQr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={upiQr} alt="UPI QR preview" className="h-24 w-24 rounded border" />
              ) : (
                <div className="text-xs text-gray-400">Enter a UPI ID to preview the QR.</div>
              )}
              {upiQr && <div className="text-xs text-gray-500">Preview (without amount). On each document the QR carries that document&apos;s balance due.</div>}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Defaults</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Default terms & conditions"><textarea className="input" rows={4} value={b.defaultTerms} onChange={(e) => set('defaultTerms', e.target.value)} /></Field>
          <Field label="Default notes"><textarea className="input" rows={4} value={b.defaultNotes} onChange={(e) => set('defaultNotes', e.target.value)} /></Field>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-1 font-semibold">Backup &amp; restore</h2>
        <p className="mb-3 text-xs text-gray-500">All data lives only on this device. Create a backup file regularly and keep a copy somewhere safe (Drive, pen drive).</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={doBackup}><Download size={16} /> Download backup</button>
          <button className="btn-ghost" onClick={() => restoreRef.current?.click()}><Upload size={16} /> Restore from backup</button>
          <input ref={restoreRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) doRestore(f); }} />
        </div>
      </section>

      {dirty && (
        <div className="sticky bottom-20 z-20 flex justify-end md:bottom-4">
          <button className="btn-primary shadow-lg" onClick={save}><Save size={16} /> Save changes</button>
        </div>
      )}
    </div>
  );
}
