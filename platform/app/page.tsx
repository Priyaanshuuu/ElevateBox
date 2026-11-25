/* eslint-disable react-hooks/error-boundaries */
import Link from "next/link";
import { DashboardShell, ErrorState, StatusBadge, formatDate } from "./components/dashboard-shell";
import { getCalls, getOverviewData } from "../lib/dashboard";
import { getBolnaExecutions, getBolnaOperationsSummary } from "../lib/dashboard-bolna";
import { formatDashboardCost } from "../lib/bolna/dashboard-projection";

export default async function Home() {
  try {
    const [stats, calls, bolna, executions] = await Promise.all([getOverviewData(), getCalls(), getBolnaOperationsSummary(), getBolnaExecutions()]);
    return <DashboardShell active="Overview" eyebrow="System overview" title="Good morning, operator." description="A live read on conversations, qualification, and follow-up activity.">
      <section className="metric-grid" aria-label="System metrics">
        <Metric label="Total leads" value={stats.totalLeads} tone="blue" /><Metric label="HOT leads" value={stats.hotLeads} tone="coral" /><Metric label="WARM leads" value={stats.warmLeads} tone="amber" /><Metric label="COLD leads" value={stats.coldLeads} tone="slate" /><Metric label="Total calls" value={stats.totalCalls} tone="green" /><Metric label="Scheduled callbacks" value={stats.scheduledCallbacks} tone="violet" />
      </section>
      <section className="metric-grid" aria-label="Provider metrics">
        <Metric label="Bolna executions" value={bolna.totalExecutions} tone="green" /><Metric label="Terminal executions" value={bolna.terminalExecutions} tone="blue" /><Metric label="Webhook events" value={bolna.totalWebhookEvents} tone="violet" /><Metric label="Tool invocations" value={bolna.totalToolInvocations} tone="amber" /><Metric label="Failed executions" value={bolna.failedExecutions} tone="coral" /><Metric label="Recorded cost" value={formatDashboardCost(bolna.totalCost)} tone="slate" />
      </section>
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Provider activity</p><h2>Recent executions</h2></div><Link className="text-link" href="/executions">View all executions <span>→</span></Link></div>
        <div className="table-wrap"><table><thead><tr><th>Execution</th><th>Outcome</th><th>Direction</th><th>Cost</th><th>Occurred</th></tr></thead><tbody>{executions.slice(0, 6).map((execution) => <tr key={execution.id}><td><Link className="row-link" href={`/executions/${execution.executionId}`}>{execution.shortExecutionId}</Link><small>{execution.lead ? execution.lead.name || execution.lead.phoneNumber : "Unlinked execution"}</small></td><td>{execution.callStatus ? <StatusBadge value={execution.callStatus} /> : <StatusBadge value={execution.status} />}<small>{execution.status}</small></td><td>{execution.callType}</td><td>{formatDashboardCost(execution.totalCost)}</td><td>{formatDate(execution.occurredAt)}</td></tr>)}</tbody></table>{executions.length === 0 && <div className="table-empty">No Bolna executions have been ingested yet.</div>}</div>
      </section>
      <section className="content-section"><div className="section-heading"><div><p className="eyebrow">Latest activity</p><h2>Recent calls</h2></div><Link className="text-link" href="/calls">View all calls <span>→</span></Link></div>
        <div className="table-wrap"><table><thead><tr><th>Lead</th><th>Status</th><th>Started</th><th>Summary</th></tr></thead><tbody>{calls.slice(0, 6).map((call) => <tr key={call.id}><td><Link className="row-link" href={`/calls/${call.id}`}>{call.lead.name || call.lead.phoneNumber}</Link><small>{call.lead.phoneNumber}</small></td><td><StatusBadge value={call.status} /></td><td>{formatDate(call.startedAt)}</td><td className="truncate">{call.summary || "Summary pending"}</td></tr>)}</tbody></table>{calls.length === 0 && <div className="table-empty">No calls have been recorded yet.</div>}</div>
      </section>
    </DashboardShell>;
  } catch { return <DashboardShell active="Overview" eyebrow="System overview" title="Dashboard unavailable" description="The platform could not read the current system data."><ErrorState /></DashboardShell>; }
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: string }) { return <div className={`metric metric-${tone}`}><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-line" /></div>; }
