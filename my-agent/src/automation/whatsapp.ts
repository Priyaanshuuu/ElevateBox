import {
  createPendingInterestedLeadWhatsAppEvent,
  getActiveInterestedLeadWhatsAppEvent,
  markAutomationEventCompleted,
  markAutomationEventFailed,
  markAutomationEventTriggered,
} from "../../../platform/lib/services/automation.service.ts";

export type WhatsAppProviderKind = "disabled" | "twilio";

export interface WhatsAppToolConfig {
  provider: WhatsAppProviderKind;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioWhatsAppFrom?: string;
}

export interface TriggerHotLeadWhatsAppInput {
  leadId: string;
  callId?: string;
  toPhoneNumber: string;
  contextText: string;
  resumeTextOrUrl: string;
  myPhoneNumber: string;
}

type SendTextResult = { providerMessageId?: string };

interface WhatsAppProvider {
  sendTextMessage(toPhoneNumber: string, text: string): Promise<SendTextResult>;
}

class DisabledWhatsAppProvider implements WhatsAppProvider {
  async sendTextMessage(): Promise<SendTextResult> {
    throw new Error(
      "WhatsApp provider is disabled. Configure WHATSAPP_PROVIDER and provider credentials.",
    );
  }
}

class TwilioWhatsAppProvider implements WhatsAppProvider {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly from: string;

  constructor(accountSid: string, authToken: string, from: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.from = from;
  }

  async sendTextMessage(toPhoneNumber: string, text: string): Promise<SendTextResult> {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      From: normalizeWhatsAppAddress(this.from),
      To: normalizeWhatsAppAddress(toPhoneNumber),
      Body: text,
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp API request failed: ${response.status} ${body}`);
    }

    const json = (await response.json()) as { sid?: string };
    return json.sid ? { providerMessageId: json.sid } : {};
  }
}

export class HotLeadWhatsAppTool {
  private readonly provider: WhatsAppProvider;

  constructor(config: WhatsAppToolConfig) {
    this.provider = createProvider(config);
  }

  async trigger(input: TriggerHotLeadWhatsAppInput): Promise<"triggered" | "skipped-duplicate"> {
    const existing = await getActiveInterestedLeadWhatsAppEvent(input.leadId, input.callId);
    if (existing) {
      return "skipped-duplicate";
    }

    const pending = await createPendingInterestedLeadWhatsAppEvent(
      input.leadId,
      input.callId,
      {
        toPhoneNumber: input.toPhoneNumber,
        contextText: input.contextText,
      },
    );

    try {
      await markAutomationEventTriggered(pending.id);

      const message = buildHotLeadMessage(input);
      const sendResult = await this.provider.sendTextMessage(input.toPhoneNumber, message);

      await markAutomationEventCompleted(pending.id, {
        toPhoneNumber: input.toPhoneNumber,
        providerMessageId: sendResult.providerMessageId,
      });

      return "triggered";
    } catch (error) {
      await markAutomationEventFailed(
        pending.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}

function createProvider(config: WhatsAppToolConfig): WhatsAppProvider {
  if (config.provider === "disabled") {
    return new DisabledWhatsAppProvider();
  }

  if (config.provider === "twilio") {
    if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioWhatsAppFrom) {
      throw new Error(
        "Missing Twilio WhatsApp configuration. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM.",
      );
    }
    return new TwilioWhatsAppProvider(
      config.twilioAccountSid,
      config.twilioAuthToken,
      config.twilioWhatsAppFrom,
    );
  }

  throw new Error(`Unsupported WhatsApp provider: ${String(config.provider)}`);
}

function buildHotLeadMessage(input: TriggerHotLeadWhatsAppInput): string {
  return [
    "Hot lead alert from active call.",
    "",
    "Current call context:",
    input.contextText,
    "",
    "Resume:",
    input.resumeTextOrUrl,
    "",
    "My phone number:",
    input.myPhoneNumber,
  ].join("\n");
}

function normalizeWhatsAppAddress(value: string): string {
  const phone = value.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  return `whatsapp:${phone.startsWith("+") ? phone : `+${phone}`}`;
}
