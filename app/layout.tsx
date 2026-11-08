import type { Metadata, Viewport } from "next";
import "./globals.css";
import Footer from "@/components/Footer";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: {
    default: "AtomBook – GST Invoicing & Business",
    template: "%s | AtomBook",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: "/icon-512.png",
  },
  description:
    "Professional offline-first GST invoicing, billing and business documents. Your business data stays on your device.",
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
        <Shell>
          {children}
          <Footer />
        </Shell>
      </body>
    </html>
  );
}
