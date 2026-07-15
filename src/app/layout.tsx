import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Execution Lab",
  description: "Professional trading journal with analytics, imports, and performance review workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
