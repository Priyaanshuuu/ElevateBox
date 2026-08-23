export type Ternary = "yes" | "no" | "unknown";

export interface ConversationState {
  business: string | null;
  products: string[];
  productCount: number | null;
  existingWebsite: Ternary;
  websiteRequirements: string[];
  features: string[];
  budget: string | null;
  timeline: string | null;
  decisionMaker: Ternary;
  interest: Ternary;
}

export function createConversationState(): ConversationState {
  return {
    business: null,
    products: [],
    productCount: null,
    existingWebsite: "unknown",
    websiteRequirements: [],
    features: [],
    budget: null,
    timeline: null,
    decisionMaker: "unknown",
    interest: "unknown",
  };
}

export function updateConversationState(
  current: ConversationState,
  utterance: string,
): ConversationState {
  const text = utterance.toLowerCase();
  const next: ConversationState = {
    ...current,
    products: [...current.products],
    websiteRequirements: [...current.websiteRequirements],
    features: [...current.features],
  };

  const businessMatch = text.match(/(?:we are|i run|my business is|we run)\s+([^.,]+)/i);
  if (!next.business && businessMatch?.[1]) {
    next.business = businessMatch[1].trim();
  }

  const sellsMatch = text.match(/(?:we sell|i sell|we provide|we deal in)\s+([^.,]+)/i);
  if (sellsMatch?.[1]) {
    pushUnique(next.products, sellsMatch[1].trim());
  }

  const countMatch = text.match(/(?:about|around|roughly|nearly)?\s*(\d{1,6})\s*(?:products?|items?|skus?)/i);
  if (countMatch?.[1]) {
    const parsed = Number.parseInt(countMatch[1], 10);
    if (!Number.isNaN(parsed)) {
      next.productCount = parsed;
    }
  }

  if (hasAny(text, ["already have a website", "we have a website", "our website is", "existing website"])) {
    next.existingWebsite = "yes";
  }
  if (hasAny(text, ["no website", "don't have a website", "do not have a website", "not have a website"])) {
    next.existingWebsite = "no";
  }

  if (hasAny(text, ["catalog", "payment", "checkout", "whatsapp", "razorpay", "cod", "inventory", "admin panel"])) {
    if (text.includes("catalog")) pushUnique(next.features, "catalog");
    if (text.includes("payment") || text.includes("checkout")) pushUnique(next.features, "online payment + checkout");
    if (text.includes("whatsapp")) pushUnique(next.features, "whatsapp integration");
    if (text.includes("razorpay")) pushUnique(next.features, "razorpay integration");
    if (text.includes("cod")) pushUnique(next.features, "cash on delivery");
    if (text.includes("inventory")) pushUnique(next.features, "inventory management");
    if (text.includes("admin panel")) pushUnique(next.features, "admin panel");
  }

  const reqMatch = text.match(/(?:need|want|looking for)\s+([^.,]+)/i);
  if (reqMatch?.[1]) {
    pushUnique(next.websiteRequirements, reqMatch[1].trim());
  }

  const budgetMatch = text.match(
    /(?:budget|cost|price)\s*(?:is|around|about|roughly)?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\s*(?:k|lakh|lakhs|cr|crore))?)/i,
  );
  if (budgetMatch?.[1]) {
    next.budget = budgetMatch[1].trim();
  }

  const timelineMatch = text.match(/(?:timeline|by|within|in)\s+([^.,]+(?:week|weeks|month|months|day|days))/i);
  if (timelineMatch?.[1]) {
    next.timeline = timelineMatch[1].trim();
  }

  if (hasAny(text, ["i am the owner", "i decide", "i'm the decision maker", "i take decisions"])) {
    next.decisionMaker = "yes";
  }
  if (hasAny(text, ["need to ask my partner", "need to ask my manager", "need approval", "my boss decides"])) {
    next.decisionMaker = "no";
  }

  if (hasAny(text, ["interested", "let's proceed", "sounds good", "yes we can start", "share proposal"])) {
    next.interest = "yes";
  }
  if (hasAny(text, ["not interested", "no thanks", "call later", "not now"])) {
    next.interest = "no";
  }

  return next;
}

export function summarizeConversationState(state: ConversationState): string {
  return JSON.stringify(state);
}

function hasAny(text: string, parts: string[]): boolean {
  return parts.some((part) => text.includes(part));
}

function pushUnique(list: string[], value: string): void {
  if (!value) {
    return;
  }
  if (!list.some((item) => item.toLowerCase() === value.toLowerCase())) {
    list.push(value);
  }
}
