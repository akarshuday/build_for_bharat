type Props = { open: boolean; onToggle: () => void };

export default function Hamburger({ open, onToggle }: Props) {
  return (
    <button
      className={`burger${open ? ' open' : ''}`}
      type="button"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      aria-controls="menu"
      onClick={onToggle}
    >
      <span></span><span></span><span></span>
    </button>
  );
}
