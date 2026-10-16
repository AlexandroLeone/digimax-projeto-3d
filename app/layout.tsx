import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Digimax Projeto 3D",
  description: "Crie sua planta baixa, decore os ambientes e explore seu projeto em 3D.",
  other: {
    "codex-preview": "development",
  },
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
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
