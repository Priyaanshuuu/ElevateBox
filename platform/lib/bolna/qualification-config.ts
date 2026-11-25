import { createHash } from "node:crypto";
import { BolnaConfigError } from "./errors.ts";
import type {
  BolnaDispositionItem,
  BolnaExtractionCategoryCreate,
  BolnaExtractionModel,
} from "./extraction-types.ts";

export const LEAD_QUALIFICATION_CATEGORY = "Lead Qualification";
export const LEAD_QUALIFICATION_MODEL: BolnaExtractionModel = "gpt-4.1-mini";

export interface LeadQualificationPlan {
  category: BolnaExtractionCategoryCreate;
  dispositions: BolnaDispositionItem[];
  digest: string;
}

type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const output: { [key: string]: CanonicalValue } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      output[key] = canonicalize(item);
    }
    return output;
  }
  return String(value);
}

function digestPlan(
  category: BolnaExtractionCategoryCreate,
  dispositions: BolnaDispositionItem[],
): string {
  const canonical = JSON.stringify(canonicalize({ category, dispositions }));
  return createHash("sha256").update(canonical).digest("hex");
}

export function createLeadQualificationPlan(): LeadQualificationPlan {
  const category: BolnaExtractionCategoryCreate = {
    name: LEAD_QUALIFICATION_CATEGORY,
    model: LEAD_QUALIFICATION_MODEL,
    min_duration_s: 8,
    skip_voicemail: true,
  };

  const dispositions: BolnaDispositionItem[] = [
    {
      name: "business",
      category: LEAD_QUALIFICATION_CATEGORY,
      question:
        "What business or company name did the customer give? Return only the name, or an empty string if it was not mentioned.",
      is_subjective: true,
      is_objective: false,
      subjective_type: "text",
    },
    {
      name: "product_count",
      category: LEAD_QUALIFICATION_CATEGORY,
      question:
        "How many products does the customer say they have? Return only the number, or an empty string if it was not mentioned.",
      is_subjective: true,
      is_objective: false,
      subjective_type: "numeric",
    },
    {
      name: "budget",
      category: LEAD_QUALIFICATION_CATEGORY,
      question:
        "What budget did the customer state? Return the amount as spoken, or an empty string if no budget was mentioned.",
      is_subjective: true,
      is_objective: false,
      subjective_type: "text",
    },
    {
      name: "timeline",
      category: LEAD_QUALIFICATION_CATEGORY,
      question:
        "What timeline did the customer give for the store? Return the timeline as spoken, or an empty string if it was not mentioned.",
      is_subjective: true,
      is_objective: false,
      subjective_type: "text",
    },
    {
      name: "features",
      category: LEAD_QUALIFICATION_CATEGORY,
      question:
        "Which website features did the customer request? Return a short comma-separated list, or an empty string if none were mentioned.",
      is_subjective: true,
      is_objective: false,
      subjective_type: "text",
    },
    {
      name: "lead_intent",
      category: LEAD_QUALIFICATION_CATEGORY,
      question:
        "Classify the customer's buying intent from the call transcript using only the configured options.",
      is_subjective: false,
      is_objective: true,
      objective_options: [
        {
          value: "HOT",
          condition:
            "Customer is interested and gave at least one strong buying signal such as budget, timeline, decision-maker confirmation, or a specific feature request.",
        },
        {
          value: "WARM",
          condition:
            "Customer discussed a real store need but did not provide budget, timeline, decision-maker confirmation, or concrete features.",
        },
        {
          value: "COLD",
          condition: "Customer declined, was uninterested, or asked not to be contacted.",
        },
        {
          value: "UNKNOWN",
          condition: "The transcript does not contain enough caller information to classify intent.",
        },
      ],
    },
  ];

  return {
    category,
    dispositions,
    digest: digestPlan(category, dispositions),
  };
}

export function buildLeadQualificationDispositions(categoryId?: string): BolnaDispositionItem[] {
  const plan = createLeadQualificationPlan();
  validateLeadQualificationPlan(plan);
  return plan.dispositions.map((disposition) => {
    const item = { ...disposition };
    delete item.category;
    return categoryId ? { ...item, category_id: categoryId } : item;
  });
}

export function validateLeadQualificationPlan(plan: LeadQualificationPlan): void {
  if (!plan.category.name.trim()) {
    throw new BolnaConfigError("Lead qualification category name is required.");
  }
  if (!plan.category.model.trim()) {
    throw new BolnaConfigError("Lead qualification category model is required.");
  }
  if (plan.category.min_duration_s !== undefined && plan.category.min_duration_s !== null) {
    if (
      !Number.isInteger(plan.category.min_duration_s) ||
      plan.category.min_duration_s < 1 ||
      plan.category.min_duration_s > 86400
    ) {
      throw new BolnaConfigError("Lead qualification min_duration_s must be 1..86400.");
    }
  }
  if (
    plan.category.parent_disposition_id ||
    plan.category.match_mode ||
    (plan.category.match_values && plan.category.match_values.length > 0)
  ) {
    throw new BolnaConfigError(
      "Lead qualification must be a starting category, not a follow-up category.",
    );
  }
  if (plan.dispositions.length === 0) {
    throw new BolnaConfigError("Lead qualification requires at least one disposition.");
  }

  const seenNames = new Set<string>();
  for (const disposition of plan.dispositions) {
    if (seenNames.has(disposition.name)) {
      throw new BolnaConfigError(`Duplicate lead qualification disposition: ${disposition.name}.`);
    }
    seenNames.add(disposition.name);

    if (disposition.category && disposition.category_id) {
      throw new BolnaConfigError(
        `Disposition ${disposition.name} may not set both category and category_id.`,
      );
    }
    if (!disposition.question.trim()) {
      throw new BolnaConfigError(`Disposition ${disposition.name} requires a question.`);
    }
    if (!disposition.is_subjective && !disposition.is_objective) {
      throw new BolnaConfigError(
        `Disposition ${disposition.name} must be subjective or objective.`,
      );
    }
    if (disposition.is_objective && !disposition.objective_options?.length) {
      throw new BolnaConfigError(
        `Objective disposition ${disposition.name} requires objective_options.`,
      );
    }
    if (
      disposition.subjective_type === "regex" &&
      !disposition.subjective_type_config?.pattern?.trim()
    ) {
      throw new BolnaConfigError(
        `Regex disposition ${disposition.name} requires subjective_type_config.pattern.`,
      );
    }
  }
}
