import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy Policy – AtomBook",
  description: "How AtomBook handles your data. Your business data stays with you.",
};

const UPDATED = "12 November 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-2 text-sm leading-relaxed text-gray-700">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Privacy Policy" subtitle={`AtomBook by Atomprod · Last updated ${UPDATED}`} />

      <Section title="The short version">
        <ul className="list-disc space-y-1 pl-5">
          <li>AtomBook has no accounts and no database of ours. Your invoices, customers and business details are saved on your own device.</li>
          <li>If you choose to turn on Google Drive sync, a copy is saved in a hidden folder of <b>your own</b> Google Drive. We cannot see it.</li>
          <li>We do not sell your data, show ads, or track you with analytics.</li>
        </ul>
      </Section>

      <Section title="Who we are">
        <p>
          AtomBook is made by Mohammad Kaif (Atomprod). For any question about privacy, write to{" "}
          <a className="text-brand-600 underline" href="mailto:kaif@atomprod.in">kaif@atomprod.in</a>.
        </p>
      </Section>

      <Section title="What AtomBook stores, and where">
        <p>
          Everything you enter (business profile, logo and signature, customers, items, invoices, quotations, payments and settings) is stored
          in your browser or app on your own phone or computer. It never leaves your device unless you use backup or Google Drive sync below.
        </p>
        <p>
          You are the owner of this data. If it contains details of your customers, you are responsible for handling it as the law requires in your country.
        </p>
      </Section>

      <Section title="Google Drive sync (optional)">
        <p>
          Sync is off until you turn it on in Settings. When you do, you sign in with your Google account and allow AtomBook one permission:
          <i> &quot;See, create, and delete its own configuration data in your Google Drive&quot;</i> (the <code>drive.appdata</code> permission).
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>What it can access:</b> only a hidden app folder that belongs to AtomBook inside your Drive. It cannot see, read or change any of your other files,
            photos or documents. The folder does not appear in your normal Drive file list.
          </li>
          <li>
            <b>What is stored there:</b> a copy of your AtomBook data (the same data described above) so that your phone and computer can share it. Each device keeps one file.
          </li>
          <li>
            <b>Who can see it:</b> only you, through the apps you sign in to. The data goes directly between your device and Google. It does not pass through any Atomprod server, because we do not run one.
          </li>
          <li>
            <b>Your Google account details:</b> we use your sign-in only to talk to Google Drive. Your email address may be shown inside the app so you know which account is connected. It is kept on your device and is not sent to us.
          </li>
          <li>
            <b>Sign-in tokens:</b> are kept on your device (in the browser&apos;s storage, or encrypted by your operating system in the Windows and Linux app, or in the Android app&apos;s private storage).
          </li>
        </ul>
        <p>
          AtomBook&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a className="text-brand-600 underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We only use the Drive permission to provide sync between your devices. We do not use it for advertising, we do not
          sell it, and nobody at Atomprod reads it.
        </p>
      </Section>

      <Section title="Stopping sync and deleting your data">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Disconnect</b> (Settings → Google Drive sync) signs this device out of Google. Your data stays on the device.</li>
          <li><b>Delete Drive copy</b> removes AtomBook&apos;s files from your Google Drive and turns sync off on your devices. Data already on your devices is not deleted.</li>
          <li>
            You can also remove AtomBook&apos;s access at any time at{" "}
            <a className="text-brand-600 underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a>
            {" "}and delete its hidden data from Google Drive settings → Manage apps.
          </li>
          <li>To remove the data on a device, use Settings → Delete all billing data, or clear the site data or uninstall the app.</li>
        </ul>
      </Section>

      <Section title="Website, logs and cookies">
        <p>
          AtomBook does not use advertising or analytics cookies. The website is delivered by a hosting provider, which may keep standard technical server logs
          (such as IP address and the time of a request) for security and reliability. AtomBook itself stores your data using your browser&apos;s local storage, not cookies.
          Google&apos;s sign-in script is only loaded when you turn on sync.
        </p>
      </Section>

      <Section title="Children">
        <p>AtomBook is a business tool and is not directed to children.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>If this policy changes, the new version will be published on this page with a new date.</p>
      </Section>

      <Section title="Contact">
        <p>
          Mohammad Kaif, Atomprod ·{" "}
          <a className="text-brand-600 underline" href="mailto:kaif@atomprod.in">kaif@atomprod.in</a> ·{" "}
          <a className="text-brand-600 underline" href="https://atombook.atomprod.in">atombook.atomprod.in</a>
        </p>
      </Section>
    </div>
  );
}
