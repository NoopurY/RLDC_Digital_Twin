import { IBM_Plex_Sans, JetBrains_Mono, Archivo } from "next/font/google";
import AppShell from "@/components/Shell/AppShell";
import "./globals.css";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-plex" });
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const jet = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jet" });

export const metadata = {
  title: "RLDC Motor Digital Twin",
  description: "Software-defined digital twin of an RLDC motor — fault injection, DSP, diagnosis and predictive condition monitoring.",
};

export const viewport = { themeColor: "#F3EFE6" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${plex.variable} ${jet.variable} ${archivo.variable}`}>
      <body className="min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
