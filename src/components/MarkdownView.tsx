import ReactMarkdown from "react-markdown";

export function MarkdownView({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`prose prose-sm prose-neutral dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold mt-4 mb-2 pb-1 border-b border-border">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
          p: ({ children }) => <p className="text-sm leading-relaxed mb-2">{children}</p>,
          ul: ({ children }) => <ul className="text-sm list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="text-sm list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
          code: ({ className, children }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <code className="block bg-secondary/70 rounded-lg p-3 text-xs font-mono overflow-x-auto my-2">
                {children}
              </code>
            ) : (
              <code className="bg-secondary/70 rounded px-1.5 py-0.5 text-xs font-mono">{children}</code>
            );
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/30 pl-3 my-2 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ href, children }) => (
            <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <table className="text-xs border-collapse border border-border my-2 w-full">{children}</table>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-secondary/50 px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
