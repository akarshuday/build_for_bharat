import { useEffect, useState } from 'react';
import { NAV } from '../data';
import Hamburger from './Hamburger';

export default function Header({ active }: { active: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('menu-open', open);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onResize = () => window.innerWidth > 720 && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open]);

  return (
    <>
      <header className="header">
        <a className="logo" href="/" aria-label="Bright Llama">
          <img src="assets/logo.webp" alt="" width={52} height={52} />
        </a>
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className={active === n.id ? 'active' : ''}>{n.label}</a>
          ))}
        </nav>
        <a className="sign-in" href="/app">Sign in</a>
        <Hamburger open={open} onToggle={() => setOpen((o) => !o)} />
      </header>

      <div className="overlay" hidden={!open} onClick={() => setOpen(false)} />
      <nav className="menu" id="menu" aria-label="Mobile" hidden={!open} onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
        {NAV.map((n, i) => (
          <a key={n.id} href={`#${n.id}`} className={active === n.id ? 'active' : ''} style={{ '--i': i } as React.CSSProperties}>{n.label}</a>
        ))}
        <a href="/app" className="menu-cta" style={{ '--i': NAV.length } as React.CSSProperties}>Sign in</a>
      </nav>
    </>
  );
}
