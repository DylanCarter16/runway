import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { cn } from '@/lib/utils';

// Markdown in the reading font with KaTeX math, GFM tables, and highlighted code
// (DESIGN.md, Components). No raw HTML: note text is untrusted.

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-note', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }], [rehypeHighlight, { detect: false }]]}
        components={{
          a: ({ href, children: c }) => (
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
