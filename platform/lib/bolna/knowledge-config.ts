import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BolnaConfigError } from "./errors.ts";

export const SERVICE_OVERVIEW_PATH = "knowledge/service-overview.md";
export const SERVICE_OVERVIEW_PDF_PREFIX = "elevatebox-service-overview";
export const SERVICE_OVERVIEW_PDF_NAME = `${SERVICE_OVERVIEW_PDF_PREFIX}.pdf`;
export const KNOWLEDGE_LANGUAGE_SUPPORT = "multilingual" as const;

export interface ElevateBoxKnowledgePlan {
  sourcePath: string;
  fileName: string;
  sourceText: string;
  digest: string;
  chunkSize: number;
  similarityTopK: number;
  overlapping: number;
  languageSupport: typeof KNOWLEDGE_LANGUAGE_SUPPORT;
}

export interface KnowledgeGroundingEval {
  id: string;
  question: string;
  requiredTerms: readonly string[];
  forbiddenTerms: readonly string[];
}

export const KNOWLEDGE_GROUNDING_EVALS: readonly KnowledgeGroundingEval[] = [
  {
    id: "basic-store-timeline",
    question: "How long does a basic e-commerce store usually take?",
    requiredTerms: ["2 to 4 weeks"],
    forbiddenTerms: ["tomorrow", "guaranteed in one day"],
  },
  {
    id: "medium-store-timeline",
    question: "What is the typical timeline for a medium complexity store?",
    requiredTerms: ["4 to 8 weeks"],
    forbiddenTerms: ["same day", "instantly"],
  },
  {
    id: "payment-integrations",
    question: "Which payment gateways are in scope?",
    requiredTerms: ["Razorpay", "Stripe"],
    forbiddenTerms: ["PayPal only", "crypto only"],
  },
  {
    id: "pricing-guardrail",
    question: "Can you quote a final price on this call?",
    requiredTerms: ["discovery call", "depends on complexity"],
    forbiddenTerms: ["fixed price", "flat 50000", "guaranteed quote"],
  },
];

const REQUIRED_SOURCE_TERMS = [
  "custom e-commerce websites",
  "Razorpay",
  "Stripe",
  "2 to 4 weeks",
  "4 to 8 weeks",
  "discovery call",
] as const;

export function knowledgeFileName(digest: string): string {
  return `${SERVICE_OVERVIEW_PDF_PREFIX}-${digest.slice(0, 12)}.pdf`;
}

export function createElevateBoxKnowledgePlan(
  sourceText: string,
  sourcePath: string = SERVICE_OVERVIEW_PATH,
): ElevateBoxKnowledgePlan {
  validateKnowledgeSource(sourceText);
  const settings = {
    chunkSize: 512,
    similarityTopK: 15,
    overlapping: 128,
    languageSupport: KNOWLEDGE_LANGUAGE_SUPPORT,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify({ ...settings, sourcePath, sourceText }))
    .digest("hex");

  return {
    sourcePath,
    fileName: knowledgeFileName(digest),
    sourceText,
    ...settings,
    digest,
  };
}

export async function loadElevateBoxKnowledgePlan(
  rootDir: string = process.cwd(),
): Promise<ElevateBoxKnowledgePlan> {
  const sourcePath = resolve(rootDir, SERVICE_OVERVIEW_PATH);
  const sourceText = await readFile(sourcePath, "utf8");
  return createElevateBoxKnowledgePlan(sourceText, SERVICE_OVERVIEW_PATH);
}

export function validateKnowledgeSource(sourceText: string): void {
  if (sourceText.trim().length < 200 || sourceText.length > 100_000) {
    throw new BolnaConfigError("Knowledge source must be between 200 and 100000 characters.");
  }
  const normalized = sourceText.toLowerCase();
  for (const term of REQUIRED_SOURCE_TERMS) {
    if (!normalized.includes(term.toLowerCase())) {
      throw new BolnaConfigError(`Knowledge source is missing required fact: ${term}.`);
    }
  }
  if (/fixed\s+price|guaranteed\s+quote|flat\s+\d{4,}/i.test(sourceText)) {
    throw new BolnaConfigError("Knowledge source must not promise a fixed price.");
  }
}

export function evaluateKnowledgeGrounding(
  answer: string,
  evalCase: KnowledgeGroundingEval,
): boolean {
  const normalized = answer.toLowerCase();
  return (
    evalCase.requiredTerms.every((term) => normalized.includes(term.toLowerCase())) &&
    evalCase.forbiddenTerms.every((term) => !normalized.includes(term.toLowerCase()))
  );
}

function pdfEscape(value: string): string {
  return value
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(value: string, width = 88): string[] {
  if (value.length <= width) return [value];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function createKnowledgeBasePdf(plan: ElevateBoxKnowledgePlan): Buffer {
  validateKnowledgeSource(plan.sourceText);

  const lines = plan.sourceText
    .split(/\r?\n/)
    .flatMap((line) => wrapLine(line))
    .slice(0, 500);
  const content = [
    "BT",
    "/F1 11 Tf",
    "36 760 Td",
    "14 TL",
    ...lines.map((line) => `(${pdfEscape(line)}) Tj T*`),
    "ET",
  ].join("\n");
  const contentBytes = Buffer.from(`${content}\n`, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ].map((value) => Buffer.from(value, "utf8"));

  const header = Buffer.from("%PDF-1.4\n", "utf8");
  const chunks: Buffer[] = [header];
  const offsets: number[] = [0];
  let cursor = header.length;
  for (const object of objects) {
    offsets.push(cursor);
    chunks.push(object);
    cursor += object.length;
  }

  const xrefOffset = cursor;
  const xrefLines = [
    "xref",
    "0 6",
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
  ];
  const trailer = [
    "trailer",
    `<< /Size 6 /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ].join("\n");
  chunks.push(Buffer.from(`${xrefLines.join("\n")}\n${trailer}\n`, "utf8"));

  return Buffer.concat(chunks);
}
