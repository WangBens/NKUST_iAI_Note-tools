import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export function StudyMarkdown({ markdown }: { markdown: string }) {
  return (
    <article className="markdown-preview">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: 'warn' }]]}
        skipHtml
        components={{
          table: ({ children }) => (
            <div className="md-table-scroll">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Model output must not cause third-party asset requests.
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {markdown}
      </Markdown>
    </article>
  );
}
