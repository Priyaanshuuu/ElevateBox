import type { JsonValue } from "./webhook.ts";
import type { LeadFacts } from "./webhook.ts";

export const NO_USER_TURN_SUMMARY = "Summary not generated as there was no user turn";

export const QUALIFICATION_TRANSCRIPT = [
  "Agent: Hi, this is ElevateBox. Do you have a few minutes for your store project?",
  "User: Yes. We are Acme Store and we currently have 120 products.",
  "Agent: What features do you need?",
  "User: Catalog, checkout and WhatsApp notifications.",
  "Agent: Do you have a budget and timeline in mind?",
  "User: Around 50000 rupees and we want to launch in 4 weeks.",
  "Agent: Are you the decision maker?",
  "User: Yes, and I am interested in starting soon.",
].join("\n");

export const CODE_SWITCH_TRANSCRIPT = [
  "Agent: Namaste, ElevateBox se baat kar rahe hain. Kya online store ke baare mein baat kar sakte hain?",
  "User: Haan, main Acme Store se hoon. Mere paas 120 products hain.",
  "Agent: Kaun-kaun si features chahiye?",
  "User: Catalog, checkout aur WhatsApp notifications chahiye.",
  "Agent: Budget aur timeline kya hai?",
  "User: Budget 50000 rupees hai aur timeline 4 weeks.",
  "Agent: Kya aap final decision le sakte hain?",
  "User: Haan, main interested hoon.",
].join("\n");

export const EXPECTED_LEAD_FACTS: LeadFacts = {
  business: "Acme Store",
  productCount: 120,
  budget: 50000,
  timeline: "4 weeks",
  features: ["Catalog", "checkout", "WhatsApp notifications"],
  intent: "HOT",
};

function result(
  subjective: string | null,
  objective: string | null,
  confidence: number,
): JsonValue {
  return {
    subjective,
    objective,
    confidence,
    confidence_label: confidence >= 0.8 ? "High" : confidence >= 0.5 ? "Medium" : "Low",
    reasoning_subjective: null,
    reasoning_objective: null,
    validation: null,
    status: "completed",
    status_reason: null,
  };
}

export const QUALIFICATION_EXTRACTED_DATA: JsonValue = {
  "Lead Qualification": {
    business: result("Acme Store", null, 0.97),
    product_count: result("120", null, 0.95),
    budget: result("50000 rupees", null, 0.91),
    timeline: result("4 weeks", null, 0.93),
    features: result("Catalog, checkout, WhatsApp notifications", null, 0.89),
    lead_intent: result(null, "HOT", 0.94),
  },
};

export const LOW_CONFIDENCE_EXTRACTED_DATA: JsonValue = {
  "Lead Qualification": {
    business: result("Maybe Acme Store", null, 0.21),
    product_count: result("120", null, 0.92),
    lead_intent: result(null, "WARM", 0.18),
  },
};

export const SKIPPED_EXTRACTED_DATA: JsonValue = {
  "Lead Qualification": {
    business: result("Acme Store", null, 0.97),
    budget: {
      subjective: null,
      objective: null,
      confidence: 0,
      confidence_label: "Low",
      status: "skipped",
      status_reason: "no_user_turn",
    },
  },
};

export const DISPOSITION_TEST_RESPONSE = {
  extracted_data: QUALIFICATION_EXTRACTED_DATA,
};
