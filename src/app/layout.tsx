import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { ToastProvider } from "@/components/motion/toaster";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space" });

export const metadata: Metadata = {
  title: "Motion — Where Students Build Motion",
  description: "A modern student platform for networking, sharing projects, and discovering real opportunities.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${space.variable}`}>
      <head>
        {/* Set the stored theme before first paint to avoid a light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("motion-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`,
          }}
        />
      </head>
      {/* Dark mode enforced by default; light mode still available via data-theme="light". */}
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {/* subtle pulsing violet/indigo mesh behind all content */}
        <div className="mesh-gradient" aria-hidden="true" />
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
