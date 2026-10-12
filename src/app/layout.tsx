import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concessioni Portuali",
  description: "Piattaforma interna per il monitoraggio dei rapporti concessori portuali.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full bg-slate-100 font-sans text-slate-900">{children}</body>
    </html>
  );
}
