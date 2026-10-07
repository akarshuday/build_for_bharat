const d = (s: string) => ({ '--d': s } as React.CSSProperties);

export default function Hero() {
  return (
    <main className="hero">
      <div className="trust anim" style={d('0.05s')}>
        <span className="trust-pill">AI task planning for teams</span>
      </div>
      <h1 className="headline anim">
        <span className="line1">Plan Smarter.</span>
        <span className="line2">Ship Together.</span>
      </h1>
      <p className="subhead anim" style={d('0.28s')}>
        Describe your project. Bright Llama splits it into real tasks, balances the workload and hands every teammate a step-by-step guide.
      </p>
      <a className="cta anim" style={d('0.4s')} href="/app">Get Started</a>
    </main>
  );
}
