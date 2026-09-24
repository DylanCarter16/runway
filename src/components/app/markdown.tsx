import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { cn } from '@/lib/utils';

// Markdown in the reading font with KaTeX math, GFM tables, and highlighted code
// (DESIGN.md, Components). No raw HTML: note text is untrusted. Links to
// "#src-..." are Ask citation markers.

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-note', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }], [rehypeHighlight, { detect: false }]]}
        components={{
          a: ({ href, children: c }) =>
            // Ask citation markers point at the sources list under the answer.
            href?.startsWith('#src-') ? (
              <sup>
                <a href={href} className="px-0.5 font-sans text-xs font-semibold text-link no-underline hover:underline" aria-label={`Source ${String(c)}`}>
                  [{c}]
                </a>
              </sup>
            ) : href?.startsWith('#') ? (
              <a href={href}>{c}</a>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {c}
              </a>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
