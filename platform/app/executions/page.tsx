/* eslint-disable react-hooks/error-boundaries */
import Link from "next/link";
import { DashboardShell, EmptyState, ErrorState, SectionHeading, StatusBadge, formatDate } from "../components/dashboard-shell";
import { getBolnaExecutions } from "../../lib/dashboard-bolna";
import { formatDashboardCost } from "../../lib/bolna/dashboard-projection";

export default async function ExecutionsPage() {
  try {
    const executions = await getBolnaExecutions();
    return <DashboardShell active="Executions" eyebrow="Provider records" title="Bolna executions" description="Normalized call executions, outcomes, and recorded costs.">
      <section className="content-section"><SectionHeading title="Execution history" count={executions.length} />
        <div className="table-wrap"><table><thead><tr><th>Execution</th><th>Outcome</th><th>Direction</th><th>Version</th><th>Number</th><th>Duration</th><th>Cost</th><th>Occurred</th></tr></thead><tbody>{executions.map((execution) => <tr key={execution.id}><td><Link className="row-link" href={`/executions/${execution.executionId}`}>{execution.shortExecutionId}</Link><small>{execution.lead ? execution.lead.name || execution.lead.phoneNumber : "Unlinked execution"}</small></td><td>{execution.callStatus ? <StatusBadge value={execution.callStatus} /> : <StatusBadge value={execution.status} />}<small>{execution.status}</small></td><td>{execution.callType}</td><td className="mono">{execution.agentVersion}</td><td>{execution.userNumber}</td><td>{execution.durationSeconds === null ? "—" : `${execution.durationSeconds}s`}</td><td>{formatDashboardCost(execution.totalCost)}</td><td>{formatDate(execution.occurredAt)}</td></tr>)}</tbody></table>{executions.length === 0 && <EmptyState message="No Bolna executions have been ingested yet." />}</div>
      </section>
    </DashboardShell>;
  } catch { return <DashboardShell active="Executions" eyebrow="Provider records" title="Executions unavailable" description="The platform could not read normalized Bolna executions."><ErrorState /></DashboardShell>; }
}
