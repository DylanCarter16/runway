import { Fragment } from 'react';

/**
 * A search snippet with its matches marked. The database wraps matches in <mark>…</mark>;
 * everything else is shown as plain text, never parsed as HTML.
 */
export function MarkedSnippet({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/<mark>|<\/mark>/);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-[color-mix(in_oklab,var(--tie)_45%,transparent)] px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </span>
  );
}
