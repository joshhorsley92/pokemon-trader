import type { Metadata } from "next";
import { IBM_Plex_Mono, Source_Sans_3, Zilla_Slab } from "next/font/google";
import "./globals.css";

const display = Zilla_Slab({
  variable: "--font-display",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const body = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-slip",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "The Trade Counter",
    template: "%s · The Trade Counter",
  },
  description:
    "Trade in your sealed Pokémon products for store credit toward anything in our case. Build your trade, see your credit instantly, and shake on it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-[family-name:var(--font-body)]">
        {children}
      </body>
    </html>
  );
}
