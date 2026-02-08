import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mark01 · Jarvis",
  description: "Interface web Mark01 - Assistant Jarvis",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
