/* eslint-disable react-hooks/error-boundaries */
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell, EmptyState, ErrorState, SectionHeading, StatusBadge, formatDate } from "../../components/dashboard-shell";
import { getBolnaExecutionDetail } from "../../../lib/dashboard-bolna";
import { formatDashboardCost } from "../../../lib/bolna/dashboard-projection";

export default async function ExecutionDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await getBolnaExecutionDetail(id);
    if (!result) notFound();
    const { detail, events, invocations } = result;
    return <DashboardShell active="Executions" eyebrow="Execution detail" title={`Execution ${detail.shortExecutionId}`} description={`Provider record · ${formatDate(detail.occurredAt)}`}>
      <Link className="back-link" href="/executions">← Back to executions</Link>
      <div className="detail-grid">
        <section className="content-section"><SectionHeading title="Execution information" /><div className="fact-list"><Fact label="Raw Bolna status" value={<StatusBadge value={detail.status} />} /><Fact label="Internal call status" value={detail.callStatus ? <StatusBadge value={detail.callStatus} /> : "—"} /><Fact label="Terminal" value={detail.terminal ? "Yes" : "No"} /><Fact label="Direction" value={detail.callType} /><Fact label="Agent id" value={<span className="mono">{detail.agentId}</span>} /><Fact label="Agent version" value={<span className="mono">{detail.agentVersion}</span>} /><Fact label="Batch" value={<span className="mono">{detail.batchId}</span>} /><Fact label="Termination reason" value={detail.terminationReason} /></div></section>
        <section className="content-section"><SectionHeading title="Telephony and cost" /><div className="fact-list"><Fact label="Provider" value={detail.provider} /><Fact label="Provider call id" value={<span className="mono">{detail.providerCallId}</span>} /><Fact label="Agent number" value={detail.agentNumber} /><Fact label="Caller number" value={detail.userNumber} /><Fact label="Duration" value={detail.durationSeconds === null ? "—" : `${detail.durationSeconds}s`} /><Fact label="Recorded cost" value={formatDashboardCost(detail.totalCost)} /><Fact label="Recording" value={detail.recordingUrl !== "—" ? <a className="text-link" href={detail.recordingUrl}>Open recording <span>→</span></a> : "—"} /><Fact label="Linked call" value={detail.linkedCallId ? <Link className="text-link" href={`/calls/${detail.linkedCallId}`}>Open call <span>→</span></Link> : "—"} /></div></section>
      </div>
      {detail.errorMessage !== "—" && <section className="content-section"><SectionHeading title="Execution error" /><p className="error-text">{detail.errorMessage}</p></section>}
      <section className="content-section"><SectionHeading title="Generated summary" />{detail.summary ? <p className="summary-copy">{detail.summary}</p> : <EmptyState message="No summary is available for this execution." />}</section>
      <section className="content-section"><SectionHeading title="Full transcript" />{detail.transcript ? <pre className="transcript">{detail.transcript}</pre> : <EmptyState message="No transcript is available for this execution." />}</section>
      <div className="detail-grid"><section className="content-section"><SectionHeading title="Cost breakdown" /><pre className="transcript">{detail.costBreakdownText}</pre></section><section className="content-section"><SectionHeading title="Telephony payload" /><pre className="transcript">{detail.telephonyDataText}</pre></section></div>
      <div className="detail-grid"><section className="content-section"><SectionHeading title="Extracted qualification" /><pre className="transcript">{detail.extractedDataText}</pre></section><section className="content-section"><SectionHeading title="Node-level extraction" /><pre className="transcript">{detail.nodeExtractedDataText}</pre></section></div>
      <div className="detail-grid"><section className="content-section"><SectionHeading title="Webhook events" count={events.length} />{events.length ? <div className="mini-list">{events.map((event) => <div className="mini-row" key={event.id}><Link className="row-link" href="/events">{event.shortId}</Link><span>{event.eventType}</span><StatusBadge value={event.status || "unknown"} /></div>)}</div> : <EmptyState message="No webhook events for this execution." />}</section><section className="content-section"><SectionHeading title="Tool invocations" count={invocations.length} />{invocations.length ? <div className="mini-list">{invocations.map((invocation) => <div className="mini-row" key={invocation.id}><span>{invocation.toolName}</span><StatusBadge value={invocation.status} /></div>)}</div> : <EmptyState message="No tools were invoked during this execution." />}</section></div>
      <section className="content-section"><SectionHeading title="Provider timestamps" /><div className="detail-grid"><Fact label="Bolna created" value={detail.bolnaCreatedAt} /><Fact label="Bolna updated" value={detail.bolnaUpdatedAt} /><Fact label="Stored" value={detail.createdAt} /><Fact label="Updated" value={detail.updatedAt} /></div></section>
    </DashboardShell>;
  } catch (error) { if (error instanceof Error && error.message.includes("NEXT_NOT_FOUND")) throw error; return <DashboardShell active="Executions" eyebrow="Execution detail" title="Execution unavailable" description="The platform could not read this execution."><ErrorState /></DashboardShell>; }
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) { return <div className="fact"><span>{label}</span><strong>{value}</strong></div>; }
