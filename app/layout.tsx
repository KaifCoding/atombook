import type { Metadata, Viewport } from "next";
import "./globals.css";
import Footer from "@/components/Footer";
import { Shell } from "@/components/Shell";
import { PwaRegister } from "@/components/PwaRegister";
import { SyncProvider } from "@/components/SyncProvider";

export const metadata: Metadata = {
  title: {
    default: "AtomBook – GST Invoicing & Business",
    template: "%s | AtomBook",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AtomBook", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: "/icon-512.png",
  },
  description:
    "Professional offline-first GST invoicing, billing and business documents. Works offline; optionally syncs between your devices through your own Google Drive.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d4ed8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SyncProvider>
          <Shell>
            {children}
            <Footer />
          </Shell>
        </SyncProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
