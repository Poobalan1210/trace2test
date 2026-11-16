import { NavLink, Outlet } from 'react-router-dom';
import { useIsDemo, useIsLocal } from '../api/context';

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 transition-state ${isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'}`;

export function Layout() {
  const local = useIsLocal();
  const demo = useIsDemo();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-bg/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:gap-8 sm:px-6">
          <NavLink to={demo ? '/' : '/incidents'} className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber/30 bg-amber-soft">
              <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
                <path d="M5 21.5h7l4-11 4 11h7" fill="none" stroke="#F5A524" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="hidden sm:inline">Trace2Test</span>
          </NavLink>
          <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap text-[14px]">
            {demo && <NavLink to="/" end className={link}>Overview</NavLink>}
            <NavLink to="/incidents" className={link}>Failures</NavLink>
            <NavLink to="/setup" className={(a) => `${link(a)} ${demo ? 'hidden sm:inline-block' : ''}`}>Setup</NavLink>
            {demo && <a href="/shop" className="rounded-md px-3 py-1.5 text-muted transition-state hover:bg-raised/60 hover:text-ink">Demo shop</a>}
          </nav>
          {local && (
            <span className="ml-auto hidden items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[12px] text-muted sm:inline-flex" title="Connected to npm run local:stack">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" /> Local stack
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
