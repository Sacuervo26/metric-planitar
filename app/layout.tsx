import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/lib/auth/use-auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Metrics Planitar",
  description: "Dashboard de metricas operativas",
};

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${spaceGrotesk.variable}`}>
      <body className="min-h-screen text-slate-900 antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
