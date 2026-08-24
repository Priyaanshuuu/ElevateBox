import type { ConversationState } from "../conversation/state.ts";
import { LeadIntent } from "../../../platform/generated/prisma/enums.ts";

export function classifyLeadIntent(state: ConversationState): typeof LeadIntent[keyof typeof LeadIntent] {
  const hasCoreNeed = Boolean(state.business) || state.products.length > 0 || state.websiteRequirements.length > 0;
  const hasBudget = Boolean(state.budget);
  const hasTimeline = Boolean(state.timeline);
  const hasConcreteFeatures = state.features.length > 0;

  if (state.interest === "no") {
    return LeadIntent.COLD;
  }

  if (
    state.interest === "yes" &&
    (hasBudget || hasTimeline || state.decisionMaker === "yes" || hasConcreteFeatures)
  ) {
    return LeadIntent.HOT;
  }

  if (
    hasCoreNeed &&
    (hasBudget || hasTimeline || hasConcreteFeatures) &&
    state.decisionMaker !== "no"
  ) {
    return LeadIntent.HOT;
  }

  if (hasCoreNeed) {
    return LeadIntent.WARM;
  }

  if (state.decisionMaker === "no" || state.interest === "unknown") {
    return LeadIntent.UNKNOWN;
  }

  return LeadIntent.COLD;
}
