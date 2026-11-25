import type {
  BolnaWebhookStore,
  CreateBolnaEventInput,
  UpdateLeadInput,
  UpsertBolnaExecutionInput,
  UpsertCallInput,
} from "./webhook-store.ts";

export class ReliabilityStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReliabilityStoreError";
  }
}

export interface MemoryWebhookStoreOptions {
  /** Simulate a durable store failure when an event is marked processed. */
  failProcessedEvents?: boolean;
}

export interface StoredWebhookEvent extends CreateBolnaEventInput {
  id: string;
  processedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
}

export interface StoredBolnaExecution extends UpsertBolnaExecutionInput {
  id: string;
}

export interface StoredCall extends UpsertCallInput {
  id: string;
}

export interface StoredLead {
  id: string;
  phoneNumber: string;
  data: UpdateLeadInput;
}

export interface MemoryWebhookStoreSnapshot {
  events: number;
  processedEvents: number;
  failedEvents: number;
  executions: number;
  calls: number;
  leads: number;
}

/**
 * Offline-only BolnaWebhookStore. It is deliberately deterministic and never
 * touches PostgreSQL, Bolna, or any network resource.
 */
export class MemoryWebhookStore implements BolnaWebhookStore {
  events: StoredWebhookEvent[] = [];
  executions: StoredBolnaExecution[] = [];
  calls: StoredCall[] = [];
  leads: StoredLead[] = [];
  failProcessedEvents: boolean;
  private sequence = 0;

  constructor(options: MemoryWebhookStoreOptions = {}) {
    this.failProcessedEvents = options.failProcessedEvents ?? false;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  snapshot(): MemoryWebhookStoreSnapshot {
    return {
      events: this.events.length,
      processedEvents: this.events.filter((event) => event.processedAt !== null).length,
      failedEvents: this.events.filter((event) => event.failedAt !== null).length,
      executions: this.executions.length,
      calls: this.calls.length,
      leads: this.leads.length,
    };
  }

  async findEventByDedupeKey(dedupeKey: string) {
    const event = this.events.find((item) => item.dedupeKey === dedupeKey);
    return event ? { id: event.id } : null;
  }

  async findExecution(executionId: string) {
    const execution = this.executions.find((item) => item.executionId === executionId);
    return execution ? { id: execution.id, status: execution.status } : null;
  }

  async upsertExecution(input: UpsertBolnaExecutionInput) {
    const existing = this.executions.find((item) => item.executionId === input.executionId);
    if (existing) {
      Object.assign(existing, input);
      return { id: existing.id };
    }
    const execution: StoredBolnaExecution = { ...input, id: this.nextId("execution") };
    this.executions.push(execution);
    return { id: execution.id };
  }

  async createEvent(input: CreateBolnaEventInput) {
    if (this.events.some((item) => item.dedupeKey === input.dedupeKey)) {
      return null;
    }
    const id = this.nextId("event");
    this.events.push({
      ...input,
      id,
      processedAt: null,
      failedAt: null,
      errorMessage: null,
    });
    return id;
  }

  async findCallByExecutionRef(executionRef: string) {
    const call = this.calls.find((item) => item.bolnaExecutionRef === executionRef);
    return call ? { id: call.id } : null;
  }

  async createCall(input: UpsertCallInput) {
    const call: StoredCall = { ...input, id: this.nextId("call") };
    this.calls.push(call);
    return { id: call.id };
  }

  async updateCall(callId: string, input: Partial<UpsertCallInput>) {
    const call = this.calls.find((item) => item.id === callId);
    if (call) Object.assign(call, input);
  }

  async getOrCreateLead(phoneNumber: string) {
    const existing = this.leads.find((item) => item.phoneNumber === phoneNumber);
    if (existing) return { id: existing.id };
    const lead: StoredLead = {
      id: this.nextId("lead"),
      phoneNumber,
      data: {},
    };
    this.leads.push(lead);
    return { id: lead.id };
  }

  async updateLead(leadId: string, input: UpdateLeadInput) {
    const lead = this.leads.find((item) => item.id === leadId);
    if (lead) Object.assign(lead.data, input);
  }

  async markEventProcessed(eventId: string) {
    if (this.failProcessedEvents) {
      throw new ReliabilityStoreError("Simulated processed-event write failure.");
    }
    const event = this.events.find((item) => item.id === eventId);
    if (event) {
      event.processedAt = new Date("2026-11-26T12:00:00.000Z");
      event.failedAt = null;
      event.errorMessage = null;
    }
  }

  async markEventFailed(eventId: string, message: string) {
    const event = this.events.find((item) => item.id === eventId);
    if (event) {
      event.failedAt = new Date("2026-11-26T12:00:00.000Z");
      event.errorMessage = message.slice(0, 500);
    }
  }
}
