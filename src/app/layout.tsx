import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polarity — See both sides.",
  description: "A social network for positions, arguments, and changing your mind.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full"
    >
      <body>{children}</body>
    </html>
  );
}
