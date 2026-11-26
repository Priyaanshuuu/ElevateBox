import Link from "next/link";
import "./showcase.css";

export const metadata = {
  title: "Voice Sales — qualified conversations, without the noise",
  description:
    "Voice Sales calls, qualifies, and follows up so your team only speaks to buyers who are ready.",
};

const features = [
  {
    id: "answering",
    number: "01",
    label: "Answering",
    title: "A voice that sounds like your team",
    detail: [
      "The agent answers in the caller's language and stays in it. English, Hindi, and Telugu switch mid-conversation from configuration, not from a prompt hoping the model will comply.",
      "Turn taking is handled by endpointing and voice activity detection. A pause is a pause — the agent waits instead of guessing that silence meant the caller finished.",
      "Interruption is a normal part of a call. When a caller cuts in, the agent stops, listens, and picks up the thread without restarting the script.",
    ],
    pane: {
      label: "live call · 04:12",
      rows: [
        ["Caller", "needs a quote for 40 seats"],
        ["Agent", "Let me check your planOptions"],
      ] as [string, string][],
      bars: [62, 78, 44, 55, 70],
    },
  },
  {
    id: "qualification",
    number: "02",
    label: "Qualification",
    title: "Only the signal, not the transcript",
    detail: [
      "Every conversation produces a typed qualification record: intent, business, product count, budget, and timeline. A confidence guard keeps weak extractions out of the pipeline.",
      "When a summary cannot be grounded in an actual user turn, it is skipped rather than invented. An empty field stays empty — the dashboard says so plainly.",
      "Disposition is recorded once, at the end of the call, and cannot be rewritten by a later webhook replay.",
    ],
    pane: {
      label: "qualification · extracted",
      rows: [
        ["Intent", "HOT · ready to buy"],
        ["Budget", "₹2–5L confirmed"],
      ] as [string, string][],
      bars: [55, 88, 40, 66, 52],
    },
  },
  {
    id: "followup",
    number: "03",
    label: "Follow-up",
    title: "The next call is already scheduled",
    detail: [
      "A callback is a first-class record with a time, a reason, and a state. Scheduled, triggered, completed — each transition is written once and shown where operators already work.",
      "Workflow callbacks are HMAC-signed and deduplicated. A retry cannot create a second task or move a lead twice.",
      "Nothing is sent to WhatsApp without an explicit, reviewed action. The agent never messages a lead on its own.",
    ],
    pane: {
      label: "callback · scheduled",
      rows: [
        ["When", "Tomorrow, 10:30 IST"],
        ["Reason", "Pricing follow-up"],
      ] as [string, string][],
      bars: [70, 48, 84, 38, 60],
    },
  },
  {
    id: "operations",
    number: "04",
    label: "Operations",
    title: "One read on cost, health, and outcome",
    detail: [
      "Bolna executions, webhook events, and tool invocations are normalized into one dashboard. The view is read-only and derived from durable records, not recomputed from memory.",
      "Cost is estimated before a call, with voice AI, platform fee, and carrier charges shown separately. Carrier rates are never assumed to be the same as Bolna's per-minute price.",
      "The live runtime is pinned to an immutable agent version. Nothing mutates a running agent to test a change.",
    ],
    pane: {
      label: "provider · healthy",
      rows: [
        ["Version", "pinned · no drift"],
        ["Cost", "carrier billed separately"],
      ] as [string, string][],
      bars: [58, 42, 72, 90, 34],
    },
  },
];

export default function ShowcasePage() {
  return (
    <div className="showcase">
      <header className="showcase-nav">
        <Link className="showcase-wordmark" href="/showcase">
          Voice Sales
        </Link>
        <nav aria-label="Page sections">
          <a href="#features">What it does</a>
          <Link href="/">Open dashboard <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <main>
        <section className="showcase-hero">
          <div className="showcase-hero-copy">
            <p className="showcase-kicker">Voice sales · operations</p>
            <h1>The calls your team would have made, already made.</h1>
            <p className="showcase-lede">
              Voice Sales calls every lead, qualifies the conversation, and books the follow-up.
              Your team opens the dashboard to a shortlist — not a queue of dials.
            </p>
            <div className="showcase-actions">
              <Link className="showcase-primary" href="/">Open the dashboard <span aria-hidden="true">→</span></Link>
              <a className="showcase-secondary" href="#features">See how it works <span aria-hidden="true">↓</span></a>
            </div>
            <p className="showcase-proof">
              Every call pinned to an immutable agent version. No live call is placed by a demo.
            </p>
          </div>
          <div className="showcase-hero-stage" aria-hidden="true">
            <HeroPane />
          </div>
        </section>

        <section className="showcase-features" id="features">
          <div className="showcase-features-head">
            <p className="showcase-kicker">What it does</p>
            <h2>Four things, done quietly.</h2>
            <p className="showcase-features-note">
              Scroll the index to move between them. Each panel opens to the detail.
            </p>
          </div>
          <div className="showcase-features-grid">
            <nav className="showcase-index" aria-label="Features">
              {features.map((feature) => (
                <a key={feature.id} href={`#${feature.id}`}>
                  <span className="showcase-index-number">{feature.number}</span>
                  <span>{feature.label}</span>
                </a>
              ))}
            </nav>
            <div className="showcase-panels">
              {features.map((feature) => (
                <article className="showcase-panel" id={feature.id} key={feature.id}>
                  <div className="showcase-panel-top">
                    <div>
                      <p className="showcase-panel-number">{feature.number} / 04</p>
                      <h3>{feature.title}</h3>
                    </div>
                    <div className="showcase-panel-pane" aria-hidden="true">
                      <FauxPane label={feature.pane.label} rows={feature.pane.rows} bars={feature.pane.bars} />
                    </div>
                  </div>
                  <div className="showcase-panel-detail" tabIndex={0} role="region" aria-label={`${feature.label} detail`}>
                    {feature.detail.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                  <p className="showcase-scroll-hint">Scroll for more <span aria-hidden="true">↓</span></p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="showcase-closer">
          <p className="showcase-kicker">Built for operators</p>
          <h2>No theatre. Just the shortlist.</h2>
          <Link className="showcase-primary" href="/">Open the dashboard <span aria-hidden="true">→</span></Link>
        </section>
      </main>

      <footer className="showcase-footer">
        <span>Voice Sales</span>
        <span>ElevateBox · internal operations</span>
      </footer>
    </div>
  );
}

function HeroPane() {
  return (
    <div className="hero-pane">
      <div className="hero-pane-chrome">
        <span className="hero-pane-dots"><i /><i /><i /></span>
        <span>Operations · Overview</span>
      </div>
      <div className="hero-pane-body">
        <div className="hero-pane-side">
          <span className="hero-pane-brand">Voice Sales</span>
          <span className="hero-pane-nav active">Overview</span>
          <span className="hero-pane-nav">Leads</span>
          <span className="hero-pane-nav">Calls</span>
          <span className="hero-pane-nav">Executions</span>
        </div>
        <div className="hero-pane-main">
          <span className="hero-pane-label">System overview</span>
          <span className="hero-pane-title">Good morning, operator.</span>
          <div className="hero-pane-metrics">
            <div><span>HOT leads</span><strong>18</strong></div>
            <div><span>Calls today</span><strong>64</strong></div>
            <div><span>Callbacks</span><strong>7</strong></div>
          </div>
          <div className="hero-pane-table">
            <div className="hero-pane-table-head"><span>Lead</span><span>Outcome</span><span>Occurred</span></div>
            <div className="hero-pane-row lead"><span>R. Mehta · 40 seats</span><span>HOT</span><span>09:42</span></div>
            <div className="hero-pane-row"><span className="hero-pane-bar w72" /><span className="hero-pane-bar w40" /><span className="hero-pane-bar w24" /></div>
            <div className="hero-pane-row"><span className="hero-pane-bar w58" /><span className="hero-pane-bar w34" /><span className="hero-pane-bar w20" /></div>
            <div className="hero-pane-row"><span className="hero-pane-bar w66" /><span className="hero-pane-bar w44" /><span className="hero-pane-bar w28" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FauxPane({
  label,
  rows,
  bars,
}: {
  label: string;
  rows: [string, string][];
  bars: number[];
}) {
  return (
    <div className="faux-pane">
      <div className="faux-pane-chrome">
        <span className="faux-pane-dots"><i /><i /></span>
        <span>{label}</span>
      </div>
      <div className="faux-pane-body">
        {rows.map(([name, value], index) => (
          <div className="faux-pane-row" key={name}>
            <span className="faux-pane-name">{name}</span>
            <span className="faux-pane-value">{value}</span>
            <span className="faux-pane-bar" style={{ width: `${bars[index]}%` }} />
          </div>
        ))}
        <div className="faux-pane-row quiet">
          <span className="faux-pane-bar" style={{ width: `${bars[2]}%` }} />
          <span className="faux-pane-bar" style={{ width: `${bars[3]}%` }} />
        </div>
      </div>
    </div>
  );
}
