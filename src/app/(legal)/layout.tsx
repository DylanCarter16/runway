import Link from 'next/link';
import { LegalFooter } from '@/components/app/legal-footer';

// Public pages (no sign-in): privacy and terms. proxy.ts lets these paths through.

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid min-h-dvh max-w-2xl content-start gap-8 px-4 py-10">
      <Link href="/" className="text-lg font-semibold">
        Runway
      </Link>
      <main className="grid gap-4 leading-relaxed [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">{children}</main>
      <LegalFooter />
    </div>
  );
}
