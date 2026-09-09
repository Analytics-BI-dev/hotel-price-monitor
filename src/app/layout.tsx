import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Hotel Price Monitor",
    template: "%s | Hotel Price Monitor",
  },
  description:
    "Plataforma de consulta de tarifas e monitoramento de preços de hotéis.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

