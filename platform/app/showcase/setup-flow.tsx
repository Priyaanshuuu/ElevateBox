"use client";

import { useEffect, useState } from "react";
import { FauxPane } from "./faux-pane";

const REPO = "https://github.com/Priyaanshuuu/ElevateBox/blob/main";

type LinkItem = { label: string; href: string };

type Step = {
  id: string;
  number: string;
  label: string;
  title: string;
  paragraphs: string[];
  items?: string[];
  links: LinkItem[];
  pane?: {
    label: string;
    rows: [string, string][];
    bars: number[];
  };
  kind?: "cost" | "gate";
};

const steps: Step[] = [
  {
    id: "get",
    number: "01",
    label: "What you get",
    title: "The same screen, filled with real calls.",
    paragraphs: [
      "Everything above is a still frame. Run this repo locally or deploy it to your own domain and these panes fill with executions, qualification records, callbacks, and cost lines from your own workspace.",
      "This showcase places no calls. It is the interface you get once the wiring below is done.",
    ],
    pane: {
      label: "operations · your workspace",
      rows: [
        ["Executions", "recorded from webhooks"],
        ["Qualified", "HOT / WARM / COLD"],
      ] as [string, string][],
      bars: [68, 52, 74, 40, 61],
    },
    links: [
      { label: "README", href: `${REPO}/README.md` },
      { label: "Step 9 — normalized dashboard", href: `${REPO}/docs/13-step9-normalized-dashboard.md` },
    ],
  },
  {
    id: "bring",
    number: "02",
    label: "What you bring",
    title: "Four inputs. Nothing optional gets invented.",
    paragraphs: [
      "A Postgres URL, a Bolna API key, a public HTTPS webhook with a long random token, and — only for live calls — a carrier trunk and number.",
      "Every value stays in platform/.env.local. It is gitignored; never commit it.",
    ],
    items: [
      "DATABASE_URL — hosted Postgres with sslmode=verify-full",
      "BOLNA_API_KEY — from the Bolna dashboard",
      "BOLNA_WEBHOOK_URL_TOKEN + BOLNA_WEBHOOK_URL — public HTTPS path ending in the token",
      "BOLNA_WEBHOOK_IP_ALLOWLIST — Bolna's published IPs, mirrored at your firewall",
      "For SIP: gateways, carrier IPs, an E.164 number, and pinned agent + version ids",
    ],
    links: [
      { label: ".env.example", href: `${REPO}/platform/.env.example` },
      { label: "Step 1 — Bolna foundation", href: `${REPO}/docs/05-step1-bolna-foundation.md` },
      { label: "Connect a SIP carrier", href: "https://www.bolna.ai/docs/sip-trunking/connect-carrier" },
      { label: "Buy a number", href: "https://www.bolna.ai/docs/buying-phone-numbers" },
    ],
  },
  {
    id: "wire",
    number: "03",
    label: "The steps",
    title: "Install, evaluate, then opt in one gate at a time.",
    paragraphs: [
      "Run these in order. Every command that touches a provider is opt-in and stays off until the offline gates pass.",
    ],
    items: [
      "pnpm install → copy platform/.env.example to platform/.env.local → fill DATABASE_URL and BOLNA_API_KEY",
      "pnpm eval — offline evals must pass before any opt-in",
      "pnpm dev — open the dashboard at localhost:3000",
      "pnpm prisma:migrate:deploy — apply migrations to your own database",
      "pnpm bolna:agent:apply — saves a new immutable agent version; never mutates the live agent",
      "pnpm bolna:extraction:apply → pnpm bolna:knowledge:apply — qualification config and grounding PDF",
      "pnpm bolna:trunk:plan — offline trunk plan, masked caller id, worst-case cost",
      "pnpm bolna:canary:preflight — offline review packet; stays BLOCKED without real rates and authorization",
    ],
    links: [
      { label: "Step 3 — agent versions", href: `${REPO}/docs/07-step3-agent-config-versioning.md` },
      { label: "Step 4 — extraction", href: `${REPO}/docs/08-step4-extraction-summary.md` },
      { label: "Step 5 — knowledge and tools", href: `${REPO}/docs/09-step5-knowledge-tools.md` },
      { label: "Step 6 — SIP trunk", href: `${REPO}/docs/10-step6-telephony-canary.md` },
      { label: "Step 12 — preflight", href: `${REPO}/docs/16-step12-live-canary-preflight.md` },
    ],
  },
  {
    id: "cost",
    number: "04",
    label: "The cost",
    title: "Three lines, kept separate on purpose.",
    paragraphs: [
      "Bolna bills voice AI and its platform fee per minute. Your carrier bills telephony separately — the dashboard never folds the two into one number.",
    ],
    kind: "cost",
    links: [
      { label: "Bolna pricing", href: "https://bolna.ai/pricing" },
      { label: "Call pricing breakdown", href: "https://www.bolna.ai/docs/pricing/call-pricing" },
      { label: "Preferred models", href: "https://www.bolna.ai/docs/pricing/preferred-models" },
      { label: "Step 10 — cost gate", href: `${REPO}/docs/14-step10-reliability-cost-load.md` },
    ],
  },
  {
    id: "gate",
    number: "05",
    label: "The live gate",
    title: "One call, only after every gate agrees.",
    paragraphs: [
      "Static transcript → reliability/cost/load → rollback drill → offline preflight → fresh readiness and cost checks → explicit authorization → one pinned call, dry-run first.",
      "No live call has been placed in this repository. The preflight is BLOCKED until real carrier details, rates, a reviewed plan digest, and authorization exist.",
    ],
    kind: "gate",
    links: [
      { label: "Step 7 — transcript gate", href: `${REPO}/docs/11-step7-static-transcript-gate.md` },
      { label: "Step 11 — rollback drill", href: `${REPO}/docs/15-step11-rollback-drill.md` },
      { label: "Step 12 — preflight", href: `${REPO}/docs/16-step12-live-canary-preflight.md` },
      { label: "Step 8 — canary harness", href: `${REPO}/docs/12-step8-live-canary-harness.md` },
      { label: "Migration inventory", href: `${REPO}/docs/04-bolna-migration-inventory.md` },
    ],
  },
];

export function SetupFlow() {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const update = () => {
      const section = document.getElementById("setup");
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      const ratio = scrollable > 0 ? -rect.top / scrollable : 0;
      setProgress(Math.min(100, Math.max(0, ratio * 100)));

      const marker = Math.min(window.innerHeight * 0.4, 320);
      let next = 0;
      document
        .querySelectorAll<HTMLElement>("[data-setup-step]")
        .forEach((node, index) => {
          if (node.getBoundingClientRect().top <= marker) next = index;
        });
      setActive(next);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="setup-flow" id="setup">
      <div className="setup-flow-head">
        <p className="showcase-kicker">Make it yours</p>
        <p className="setup-flow-note">
          This page is a still of a working system. Scroll to see what you get, what you
          bring, and the exact order of operations.
        </p>
      </div>

      <div className="setup-flow-grid">
        <nav className="setup-rail" aria-label="Setup sequence">
          <p className="setup-rail-label">Setup sequence</p>
          <div className="setup-progress" aria-hidden="true">
            <span style={{ height: `${progress}%` }} />
          </div>
          <div className="setup-rail-links">
            {steps.map((step, index) => (
              <a
                key={step.id}
                href={`#${step.id}`}
                className={index === active ? "active" : undefined}
                aria-current={index === active ? "step" : undefined}
              >
                <span className="setup-rail-number">{step.number}</span>
                <span>{step.label}</span>
              </a>
            ))}
          </div>
          <p className="setup-rail-hint">Scroll to follow along <span aria-hidden="true">↓</span></p>
        </nav>

        <div className="setup-steps">
          {steps.map((step, index) => (
            <article
              className={`setup-step${index === active ? " is-active" : ""}`}
              id={step.id}
              data-setup-step={index}
              key={step.id}
            >
              <p className="setup-step-number">{step.number} / 05</p>
              <h3>{step.title}</h3>
              {step.paragraphs.map((paragraph) => (
                <p className="setup-copy" key={paragraph}>{paragraph}</p>
              ))}

              {step.pane && (
                <div className="setup-step-pane" aria-hidden="true">
                  <FauxPane
                    label={step.pane.label}
                    rows={step.pane.rows}
                    bars={step.pane.bars}
                  />
                </div>
              )}

              {step.items && (
                <ol className="setup-items">
                  {step.items.map((item) => (
                    <li key={item}>
                      <span className="setup-item-marker" aria-hidden="true" />
                      <code>{item}</code>
                    </li>
                  ))}
                </ol>
              )}

              {step.kind === "cost" && (
                <div className="setup-costs">
                  <div>
                    <span>Voice AI</span>
                    <strong>$0.06<small>/min</small></strong>
                    <p>≈ ₹5.52 at standard wallet tiers. Preferred STT + LLM + TTS included.</p>
                  </div>
                  <div>
                    <span>Bolna platform</span>
                    <strong>$0.02<small>/min</small></strong>
                    <p>Flat per-minute fee on top of provider charges.</p>
                  </div>
                  <div>
                    <span>Telephony</span>
                    <strong>your carrier</strong>
                    <p>Per-minute plus connection fee, minimums, and rounding. Quote it from your invoice.</p>
                  </div>
                </div>
              )}

              {step.kind === "cost" && (
                <div className="setup-formula">
                  <span className="setup-formula-label">Worst case</span>
                  <code>call cap × (voice AI + platform + carrier) + connection fee</code>
                  <p>
                    Published Bolna rates can change with wallet tier and model choice. The evals use
                    fixtures, not your rates — fill real values from your wallet and carrier invoice
                    before the cost gate can pass.
                  </p>
                </div>
              )}

              {step.kind === "gate" && (
                <div className="setup-gate-grid">
                  <div><span>Static transcript</span><strong>PASS</strong></div>
                  <div><span>Reliability / cost / load</span><strong>PASS</strong></div>
                  <div><span>Rollback drill</span><strong>PASS</strong></div>
                  <div><span>Offline preflight</span><strong className="blocked">BLOCKED</strong></div>
                  <div><span>Dry run</span><strong>1</strong></div>
                  <div><span>Live calls placed</span><strong>false</strong></div>
                </div>
              )}

              <div className="setup-links">
                {step.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.label} <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
