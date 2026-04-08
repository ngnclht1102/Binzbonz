import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Binzbonz",
  description: "Agent Orchestration Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen flex">
        <aside className="w-56 bg-gray-900 border-r border-gray-800 p-4 flex flex-col gap-4">
          <Link href="/projects" className="text-lg font-bold tracking-tight">
            Binzbonz
          </Link>
          <nav className="flex flex-col gap-1 text-sm">
            <Link
              href="/projects"
              className="px-3 py-2 rounded hover:bg-gray-800 transition-colors"
            >
              Projects
            </Link>
          </nav>
        </aside>
        <main className="flex-1 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
