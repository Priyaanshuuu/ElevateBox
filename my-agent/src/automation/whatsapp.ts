import {
  createPendingInterestedLeadWhatsAppEvent,
  getActiveInterestedLeadWhatsAppEvent,
  markAutomationEventCompleted,
  markAutomationEventFailed,
  markAutomationEventTriggered,
} from "../../../platform/lib/services/automation.service.ts";

export type WhatsAppProviderKind = "disabled" | "meta";

export interface WhatsAppToolConfig {
  provider: WhatsAppProviderKind;
  metaPhoneNumberId?: string;
  metaAccessToken?: string;
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

class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly phoneNumberId: string;
  private readonly accessToken: string;

  constructor(phoneNumberId: string, accessToken: string) {
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
  }

  async sendTextMessage(toPhoneNumber: string, text: string): Promise<SendTextResult> {
    const endpoint = `https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizeWhatsAppPhone(toPhoneNumber),
        type: "text",
        text: {
          body: text,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp API request failed: ${response.status} ${body}`);
    }

    const json = (await response.json()) as {
      messages?: Array<{ id?: string }>;
    };
    const messageId = json.messages?.[0]?.id;
    return messageId ? { providerMessageId: messageId } : {};
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

  if (config.provider === "meta") {
    if (!config.metaPhoneNumberId || !config.metaAccessToken) {
      throw new Error(
        "Missing WhatsApp Meta configuration. Set WHATSAPP_META_PHONE_NUMBER_ID and WHATSAPP_META_ACCESS_TOKEN.",
      );
    }
    return new MetaWhatsAppProvider(config.metaPhoneNumberId, config.metaAccessToken);
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

function normalizeWhatsAppPhone(value: string): string {
  return value.replace(/[^\d]/g, "");
}
