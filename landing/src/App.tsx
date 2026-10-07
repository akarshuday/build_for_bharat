import { NAV } from './data';
import { useScrollSpy } from './hooks/useScrollSpy';
import VideoBg from './components/VideoBg';
import Header from './components/Header';
import Hero from './components/Hero';
import Stats from './components/Stats';
import Sections from './components/Sections';

const IDS = NAV.map((n) => n.id);

export default function App() {
  const active = useScrollSpy(IDS);
  return (
    <>
      <VideoBg />
      <div className="page" id="home">
        <Header active={active} />
        <Hero />
        <Stats />
      </div>
      <Sections />
    </>
  );
}
