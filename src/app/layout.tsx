import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polarity — See both sides.",
  description: "A social network for positions, arguments, and changing your mind.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className="h-full"
    >
      <body>{children}</body>
    </html>
  );
}
