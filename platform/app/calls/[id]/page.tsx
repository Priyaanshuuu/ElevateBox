/* eslint-disable react-hooks/error-boundaries */
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell, EmptyState, ErrorState, SectionHeading, StatusBadge, formatDate } from "../../components/dashboard-shell";
import { getCallDetails } from "../../../lib/dashboard";
import { getExecutionForCall } from "../../../lib/dashboard-bolna";
import { formatDashboardCost } from "../../../lib/bolna/dashboard-projection";

export default async function CallDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const call = await getCallDetails(id);
    if (!call) notFound();
    const execution = call.bolnaExecutionId ? await getExecutionForCall(call.bolnaExecutionId) : null;
    return <DashboardShell active="Calls" eyebrow="Conversation detail" title={call.lead.name || call.lead.phoneNumber} description={`Call record · ${formatDate(call.createdAt)}`}>
      <Link className="back-link" href="/calls">← Back to calls</Link>
      <div className="detail-grid">
        <section className="content-section"><SectionHeading title="Call information" /><div className="fact-grid"><Fact label="Status" value={<StatusBadge value={call.status} />} /><Fact label="Phone" value={call.lead.phoneNumber} /><Fact label="Started" value={formatDate(call.startedAt)} /><Fact label="Ended" value={formatDate(call.endedAt)} /><Fact label="Lead intent" value={<StatusBadge value={call.lead.intent} />} /><Fact label="Business" value={call.lead.business || "—"} /></div></section>
        <section className="content-section"><SectionHeading title="Lead qualification" /><div className="fact-list"><Fact label="Products" value={call.lead.productCount ? `${call.lead.productCount}` : "Not mentioned"} /><Fact label="Requirements" value={call.lead.features.length ? call.lead.features.join(", ") : "Not mentioned"} /><Fact label="Budget" value={call.lead.budget ? String(call.lead.budget) : "Not mentioned"} /><Fact label="Timeline" value={call.lead.timeline || "Not mentioned"} /></div></section>
      </div>
      <section className="content-section"><SectionHeading title="Normalized Bolna execution" />{execution ? <div className="fact-grid"><Fact label="Execution" value={<Link className="text-link" href={`/executions/${execution.executionId}`}>{execution.executionId.slice(-8)} <span>→</span></Link>} /><Fact label="Raw status" value={<StatusBadge value={execution.status} />} /><Fact label="Internal status" value={execution.callStatus ? <StatusBadge value={execution.callStatus} /> : "—"} /><Fact label="Agent version" value={<span className="mono">{execution.agentVersion}</span>} /><Fact label="Provider" value={execution.provider} /><Fact label="Provider call" value={<span className="mono">{execution.providerCallId}</span>} /><Fact label="Duration" value={execution.durationSeconds === null ? "—" : `${execution.durationSeconds}s`} /><Fact label="Recorded cost" value={formatDashboardCost(execution.cost)} /><Fact label="Webhook events" value={execution.eventCount} /><Fact label="Tool invocations" value={execution.toolInvocationCount} /><Fact label="Termination" value={execution.terminationReason} /><Fact label="Provider error" value={execution.errorMessage} /></div> : <EmptyState message="No normalized Bolna execution is linked to this call." />}</section>
      <section className="content-section"><SectionHeading title="Generated summary" />{call.summary ? <p className="summary-copy">{call.summary}</p> : <EmptyState message="A summary has not been generated for this call." />}</section>
      <section className="content-section"><SectionHeading title="Full transcript" />{call.transcript ? <pre className="transcript">{call.transcript}</pre> : <EmptyState message="No transcript is available for this call." />}</section>
      <div className="detail-grid"><section className="content-section"><SectionHeading title="Callbacks" count={call.callbacks.length} />{call.callbacks.length ? <div className="mini-list">{call.callbacks.map((callback) => <div className="mini-row" key={callback.id}><span>{formatDate(callback.scheduledAt)}</span><StatusBadge value={callback.status} /></div>)}</div> : <EmptyState message="No callbacks linked to this call." />}</section><section className="content-section"><SectionHeading title="Automation events" count={call.automationEvents.length} />{call.automationEvents.length ? <div className="mini-list">{call.automationEvents.map((event) => <div className="mini-row" key={event.id}><span>{event.type.replaceAll("_", " ")}</span><StatusBadge value={event.status} /></div>)}</div> : <EmptyState message="No automation events linked to this call." />}</section></div>
    </DashboardShell>;
  } catch (error) { if (error instanceof Error && error.message.includes("NEXT_NOT_FOUND")) throw error; return <DashboardShell active="Calls" eyebrow="Conversation detail" title="Call unavailable" description="The platform could not read this call."><ErrorState /></DashboardShell>; }
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) { return <div className="fact"><span>{label}</span><strong>{value}</strong></div>; }
