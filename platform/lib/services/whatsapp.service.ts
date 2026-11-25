export interface WhatsAppConfig {
  provider: "twilio";
  accountSid: string;
  authToken: string;
  from: string;
}

export interface WhatsAppSendResult {
  providerMessageId?: string;
}

export interface HotLeadWhatsAppMessageInput {
  leadId: string;
  callerPhoneNumber: string;
  contextText: string;
  resumeTextOrUrl: string;
}

export function loadWhatsAppConfig(
  env: Record<string, string | undefined> = process.env,
): WhatsAppConfig | null {
  if ((env.WHATSAPP_PROVIDER ?? "disabled").trim() !== "twilio") return null;
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_WHATSAPP_FROM?.trim();
  if (!accountSid || !authToken || !from) {
    throw new Error(
      "Missing Twilio WhatsApp configuration. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM.",
    );
  }
  return { provider: "twilio", accountSid, authToken, from };
}

export function normalizeWhatsAppAddress(value: string): string {
  const phone = value.replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  const withCountryCode = phone.startsWith("+") ? phone : `+${phone}`;
  return `whatsapp:${withCountryCode}`;
}

export function buildHotLeadWhatsAppMessage(input: HotLeadWhatsAppMessageInput): string {
  return [
    "Hot lead alert from ElevateBox.",
    "",
    "Lead:",
    input.leadId,
    "Caller:",
    input.callerPhoneNumber,
    "",
    "Current call context:",
    input.contextText,
    "",
    "Resume:",
    input.resumeTextOrUrl,
  ].join("\n");
}

export async function sendWhatsAppMessage(
  config: WhatsAppConfig,
  toPhoneNumber: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsAppSendResult> {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    From: normalizeWhatsAppAddress(config.from),
    To: normalizeWhatsAppAddress(toPhoneNumber),
    Body: text,
  });
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(`WhatsApp API request failed: ${response.status} ${detail}`);
  }
  const json = (await response.json()) as { sid?: string };
  return json.sid ? { providerMessageId: json.sid } : {};
}
