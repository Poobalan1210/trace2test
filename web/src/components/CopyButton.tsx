import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copies text and announces "Copied" to screen readers. */
export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded border border-line bg-panel px-2.5 py-1 text-[12px] text-ink transition-state hover:border-muted ${className}`}
    >
      {copied ? <Check size={13} aria-hidden="true" className="text-ok" /> : <Copy size={13} aria-hidden="true" />}
      <span>{copied ? 'Copied' : label}</span>
      <span className="sr-only" aria-live="polite">{copied ? 'Copied to clipboard' : ''}</span>
    </button>
  );
}
