/* eslint-disable react-hooks/error-boundaries */
import Link from "next/link";
import { DashboardShell, EmptyState, ErrorState, SectionHeading, StatusBadge, formatDate } from "../components/dashboard-shell";
import { getBolnaEvents, getBolnaToolInvocations } from "../../lib/dashboard-bolna";

export default async function EventsPage() {
  try {
    const [events, invocations] = await Promise.all([getBolnaEvents(), getBolnaToolInvocations()]);
    return <DashboardShell active="Events" eyebrow="Delivery and automation" title="Provider events" description="Webhook deliveries and signed tool invocations stored for replay and audit.">
      <section className="content-section"><SectionHeading title="Webhook events" count={events.length} />
        <div className="table-wrap"><table><thead><tr><th>Event</th><th>Execution</th><th>Status</th><th>Source IP</th><th>Received</th><th>Processed</th><th>Error</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td className="mono">{event.shortId}<small>{event.eventType}</small></td><td><Link className="row-link" href={`/executions/${event.executionId}`}>{event.executionId.slice(-8)}</Link><small>{event.executionStatus}</small></td><td>{event.failedAt ? <StatusBadge value="failed" /> : <StatusBadge value={event.status || "unknown"} />}<small>{event.userNumber || "—"}</small></td><td className="mono">{event.sourceIp}</td><td>{formatDate(event.receivedAt)}</td><td>{formatDate(event.processedAt)}</td><td className="truncate">{event.errorMessage}</td></tr>)}</tbody></table>{events.length === 0 && <EmptyState message="No webhook events have been received yet." />}</div>
        {events.filter((event) => event.hasPayload || Object.keys(event.headers).length > 0).slice(0, 8).map((event) => <details key={event.id} className="content-section"><summary className="text-link">Inspect payload and sanitized headers · {event.shortId}</summary><div className="detail-grid"><pre className="transcript">{event.payloadText}</pre><pre className="transcript">{JSON.stringify(event.headers, null, 2)}</pre></div></details>)}
      </section>
      <section className="content-section"><SectionHeading title="Tool invocations" count={invocations.length} />
        <div className="table-wrap"><table><thead><tr><th>Invocation</th><th>Tool</th><th>Execution</th><th>Status</th><th>Created</th><th>Error</th></tr></thead><tbody>{invocations.map((invocation) => <tr key={invocation.id}><td className="mono">{invocation.shortId}<small>{invocation.dedupeKey}</small></td><td>{invocation.toolName}</td><td>{invocation.executionId === "—" ? "—" : <Link className="row-link" href={`/executions/${invocation.executionId}`}>{invocation.executionId.slice(-8)}</Link>}</td><td><StatusBadge value={invocation.status} /></td><td>{formatDate(invocation.createdAt)}</td><td className="truncate">{invocation.errorMessage}</td></tr>)}</tbody></table>{invocations.length === 0 && <EmptyState message="No custom-function tools have been invoked yet." />}</div>
        {invocations.filter((invocation) => invocation.resultText !== "—").slice(0, 8).map((invocation) => <details key={invocation.id} className="content-section"><summary className="text-link">Inspect result · {invocation.shortId}</summary><pre className="transcript">{invocation.resultText}</pre></details>)}
      </section>
    </DashboardShell>;
  } catch { return <DashboardShell active="Events" eyebrow="Delivery and automation" title="Events unavailable" description="The platform could not read provider events."><ErrorState /></DashboardShell>; }
}
