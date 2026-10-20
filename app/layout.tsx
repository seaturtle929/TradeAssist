import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade Assist · Your next move, in the moment",
  description: "Live sales guidance grounded in your manufacturer information.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
