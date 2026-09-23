import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Privacy and terms links, on the sign-in page and under every app page. */
export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('flex gap-4 text-sm text-muted-foreground', className)}>
      <Link href="/privacy" className="underline-offset-2 hover:underline">
        Privacy
      </Link>
      <Link href="/terms" className="underline-offset-2 hover:underline">
        Terms
      </Link>
    </footer>
  );
}
