import { useEffect, useRef, useState } from 'react';

export function TokenDialog({ onSubmit, localHint }: { onSubmit: (token: string) => void; localHint?: boolean }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="token-title"
      onCancel={(e) => e.preventDefault()}
      className="w-[min(420px,calc(100vw-32px))] rounded-panel border border-line bg-panel p-0 text-ink backdrop:bg-black/70"
    >
      <form
        method="dialog"
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h2 id="token-title" className="text-[15px] font-medium">Dashboard token</h2>
        <p className="mt-1 text-muted">
          Enter the <span className="font-mono text-[13px] text-ink">DashboardToken</span> you set when deploying the stack. It is kept for this tab only.
        </p>
        <label htmlFor="token" className="mt-4 block text-[12px] text-muted">Token</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded border border-line bg-bg px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-amber"
        />
        {localHint && (
          <p className="mt-3 text-[12px] text-muted">
            Running locally? The local stack's token is{' '}
            <button type="button" onClick={() => setValue('local-dashboard-token')} className="font-mono text-amber underline-offset-2 hover:underline">
              local-dashboard-token
            </button>
            .
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={!value.trim()} className="rounded bg-amber px-3.5 py-1.5 font-medium text-bg transition-state hover:brightness-110 disabled:opacity-50">
            Continue
          </button>
        </div>
      </form>
    </dialog>
  );
}
