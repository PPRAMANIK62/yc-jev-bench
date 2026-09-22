import type { Metadata } from "next";
import { Instrument_Sans, Martian_Mono, Source_Serif_4 } from "next/font/google";
import { MotionConfig } from "motion/react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./globals.css";

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  axes: ["wdth"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const martian = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "YC × Jev", template: "%s · YC × Jev" },
  description:
    "Search every YC company in plain English, and an independent benchmark of TypeSafe's Jev as a search reranker.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${instrument.variable} ${sourceSerif.variable} ${martian.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <MotionConfig reducedMotion="user">
          <SiteHeader />
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </MotionConfig>
      </body>
    </html>
  );
}
