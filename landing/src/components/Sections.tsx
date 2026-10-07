import { FEATURES, STEPS } from '../data';

type CardData = { icon: string; title: string; text: string };

const Card = ({ icon, title, text }: CardData) => (
  <article className="card">
    <span className="card-icon" aria-hidden="true"><i className={`fa-solid ${icon}`}></i></span>
    <h3>{title}</h3>
    <p>{text}</p>
  </article>
);

/** One dot per task: green = approved, amber = waiting, grey = to do. */
const DOTS = ['g', 'g', 'g', 'g', 'a', 'a', '', '', '', ''];

export default function Sections() {
  return (
    <div className="sections">
      <section className="section" id="product">
        <p className="eyebrow">How it works</p>
        <h2 className="section-title">From idea to done in 3 steps</h2>
        <p className="section-lede">No more guessing who does what. The AI drafts the plan, the manager approves it, the team follows it.</p>
        <div className="cards">{STEPS.map((s) => <Card key={s.title} {...s} />)}</div>
        <div className="mock" aria-label="Progress preview">
          <div className="mock-dots">{DOTS.map((c, i) => <i key={i} className={`d ${c}`} />)}</div>
          <div className="mock-bar"><span></span></div>
          <small>One dot per task · green = approved · amber = waiting for approval</small>
        </div>
      </section>

      <section className="section" id="case-studies">
        <p className="eyebrow">Features</p>
        <h2 className="section-title">Everything a team needs</h2>
        <div className="cards">{FEATURES.map((f) => <Card key={f.title} {...f} />)}</div>
      </section>

      <section className="section" id="contact">
        <p className="eyebrow">Start</p>
        <h2 className="section-title">Ready to plan your next project?</h2>
        <p className="section-lede">Create a free account as a manager or contributor and be running in a minute.</p>
        <div className="contact-actions"><a className="cta" href="/app">Get Started</a></div>
        <p className="foot">© Bright Llama</p>
      </section>
    </div>
  );
}
