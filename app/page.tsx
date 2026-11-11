"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileClock,
  FileMinus2,
  FilePlus,
  FilePlus2,
  HandCoins,
  Receipt,
  ScrollText,
  ShoppingBag,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui";
import { balanceDue } from "@/lib/build";
import { fmtDate, fmtMoney, todayStr } from "@/lib/gst";
import { useBusiness, useCustomers, useDocs, useItems } from "@/lib/hooks";
import { DOC_TYPE_LIST, DOC_TYPES, type DocType } from "@/lib/types";

const ICONS: Record<DocType, typeof Receipt> = {
  tax_invoice: Receipt,
  bill_of_supply: ScrollText,
  normal_bill: ShoppingBag,
  quotation: FilePlus2,
  proforma_invoice: FileClock,
  delivery_challan: Truck,
  purchase_order: ClipboardList,
  credit_note: FileMinus2,
  debit_note: FilePlus,
  payment_receipt: HandCoins,
};



export default function Dashboard() {
  const business = useBusiness();
  const docs = useDocs();
  const customers = useCustomers();
  const items = useItems();

  if (!business || !docs)
    return <div className="text-sm text-gray-500">Loading…</div>;

  const ym = todayStr().slice(0, 7);
  const sales = docs.filter(
    (d) => DOC_TYPES[d.type].sales && d.status !== "cancelled",
  );
  const month = sales.filter((d) => d.date.startsWith(ym));
  const sgn = (t: DocType) => (t === "credit_note" ? -1 : 1);
  const monthSales = month.reduce(
    (a, d) => a + sgn(d.type) * d.totals.total,
    0,
  );
  const monthTax = month.reduce((a, d) => a + sgn(d.type) * d.totals.tax, 0);
  const outstandingDocs = sales.filter(
    (d) =>
      DOC_TYPES[d.type].pay === "track" &&
      (d.status === "unpaid" || d.status === "partial"),
  );
  const outstanding = outstandingDocs.reduce((a, d) => a + balanceDue(d), 0);

  const setupDone = !!(
    business.name &&
    business.stateCode &&
    (business.gstin || business.taxScheme === "unregistered")
  );
  const steps = [
    { done: setupDone, label: "Complete business setup", href: "/settings/" },
    {
      done: !!items?.length,
      label: "Add your products / services",
      href: "/items/",
    },
    {
      done: !!docs.length,
      label: "Create your first document",
      href: `/documents/edit/?type=${business.taxScheme === "regular" ? "tax_invoice" : "normal_bill"}`,
    },
  ];
  const showOnboarding = steps.some((s) => !s.done);

  const allowed = DOC_TYPE_LIST.filter((t) =>
    DOC_TYPES[t].schemes.includes(business.taxScheme),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          business.name ? `Hello, ${business.name}` : "Welcome to AtomBook"
        }
        subtitle="GST invoicing that works offline. Your data is yours: on your device, and in your own Google Drive if you turn on sync."
      />

      {showOnboarding && (
        <section className="card border-brand-100 bg-brand-50">
          <h2 className="mb-2 font-semibold text-brand-700">Get started</h2>
          <ul className="space-y-1.5 text-sm">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                {s.done ? (
                  <CheckCircle2 size={16} className="text-green-600" />
                ) : (
                  <Circle size={16} className="text-gray-400" />
                )}
                <Link
                  href={s.href}
                  className={
                    s.done
                      ? "text-gray-500 line-through"
                      : "font-medium text-brand-700 underline"
                  }
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales this month" value={`₹ ${fmtMoney(monthSales)}`} />
        <Stat
          label="GST this month"
          value={`₹ ${fmtMoney(monthTax)}`}
          sub="Collected on tax invoices (net of credit notes)"
        />
        <Stat
          label="Outstanding"
          value={`₹ ${fmtMoney(outstanding)}`}
          sub={`${outstandingDocs.length} unpaid`}
          warn={outstanding > 0}
        />
        <Stat
          label="Customers"
          value={String(customers?.length ?? 0)}
          sub={`${items?.length ?? 0} items`}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Create new</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {allowed.map((type) => {
            const Icon = ICONS[type];
            const hint = DOC_TYPES[type].hint;
            return (
              <Link
                key={type}
                href={`/documents/edit/?type=${type}`}
                className="card flex items-center gap-3 transition hover:border-brand-500"
              >
                <span className="rounded-lg bg-brand-50 p-2 text-brand-600">
                  <Icon size={20} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    {DOC_TYPES[type].label}
                  </span>
                  <span className="text-xs text-gray-500">{hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {business.taxScheme === "regular" && (
        <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            {business.monthlyFiler
              ? "Monthly filer: GSTR-1 is due by the 11th and GSTR-3B by the 20th of the next month."
              : "QRMP scheme: GSTR-1 is due by the 13th after quarter end; GSTR-3B by the 22nd or 24th (depends on your state). "}
            <Link href="/reports/" className="font-semibold underline">
              Prepare returns
            </Link>
            . Always confirm the current due dates on the GST portal.
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Recent documents
          </h2>
          <Link href="/documents/" className="text-xs text-brand-600 underline">
            View all
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full">
            <tbody className="divide-y">
              {docs.slice(0, 8).map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="td font-mono text-xs font-semibold">
                    {d.number}
                  </td>
                  <td className="td">{DOC_TYPES[d.type].label}</td>
                  <td className="td">{d.party.name}</td>
                  <td className="td whitespace-nowrap">{fmtDate(d.date)}</td>
                  <td className="td text-right">
                    ₹ {fmtMoney(d.totals.total)}
                  </td>
                  <td className="td">
                    <StatusBadge
                      status={d.status}
                      label={
                        d.type === "quotation" && d.status === "draft"
                          ? "open"
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ))}
              {!docs.length && (
                <tr>
                  <td className="td text-center text-gray-400">
                    No documents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${warn ? "text-amber-700" : ""}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}
