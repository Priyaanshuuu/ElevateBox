import { BolnaConfigError } from "./errors.ts";

export type CanaryCurrency = "USD" | "INR";

export interface CallCostRates {
  currency: CanaryCurrency;
  voiceAiPerMinute: number;
  bolnaPlatformPerMinute: number;
  carrierPerMinute: number;
  carrierConnectionFee: number;
  carrierMinimumMinutes: number;
  carrierBillingIncrementSeconds: number;
}

export interface CallCostEstimateInput {
  rates: CallCostRates;
  callCapSeconds: number;
  usesPreferredModels: boolean;
}

export interface CallCostEstimate {
  currency: CanaryCurrency;
  callCapSeconds: number;
  bolnaBillableMinutes: number;
  carrierBillableMinutes: number;
  voiceAiCost: number;
  bolnaPlatformCost: number;
  carrierMinutesCost: number;
  carrierConnectionFee: number;
  totalCost: number;
  usesPreferredModels: boolean;
}

export interface CanaryCostGateInput {
  estimate: CallCostEstimate;
  plannedCalls: number;
  maxCallsPerCanary: number;
  maxCostPerCall: number;
  maxCanaryCost: number;
  maxConcurrentCalls: number;
}

export interface CostGateResult {
  status: "PASS" | "FAIL";
  reasons: string[];
  projectedCanaryCost: number;
}

function finiteNonNegative(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BolnaConfigError(`${field} must be a finite non-negative number.`);
  }
  return value;
}

export function validateCallCostRates(rates: CallCostRates): void {
  if (rates.currency !== "USD" && rates.currency !== "INR") {
    throw new BolnaConfigError("Canary currency must be USD or INR.");
  }
  finiteNonNegative(rates.voiceAiPerMinute, "Voice AI per-minute rate");
  finiteNonNegative(rates.bolnaPlatformPerMinute, "Bolna platform per-minute fee");
  finiteNonNegative(rates.carrierPerMinute, "Carrier per-minute rate");
  finiteNonNegative(rates.carrierConnectionFee, "Carrier connection fee");
  finiteNonNegative(rates.carrierMinimumMinutes, "Carrier minimum minutes");
  if (
    !Number.isInteger(rates.carrierBillingIncrementSeconds) ||
    rates.carrierBillingIncrementSeconds < 1 ||
    rates.carrierBillingIncrementSeconds > 60
  ) {
    throw new BolnaConfigError("Carrier billing increment must be an integer from 1 to 60 seconds.");
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateWorstCaseCallCost(input: CallCostEstimateInput): CallCostEstimate {
  validateCallCostRates(input.rates);
  if (
    !Number.isInteger(input.callCapSeconds) ||
    input.callCapSeconds < 1 ||
    input.callCapSeconds > 600
  ) {
    throw new BolnaConfigError("Canary call cap must be an integer from 1 to 600 seconds.");
  }

  const bolnaBillableMinutes = Math.ceil(input.callCapSeconds / 60);
  const roundedCarrierSeconds =
    Math.ceil(input.callCapSeconds / input.rates.carrierBillingIncrementSeconds) *
    input.rates.carrierBillingIncrementSeconds;
  const carrierBillableMinutes = Math.max(
    Math.ceil(input.rates.carrierMinimumMinutes),
    Math.ceil(roundedCarrierSeconds / 60),
  );

  const voiceAiCost = bolnaBillableMinutes * input.rates.voiceAiPerMinute;
  const bolnaPlatformCost = bolnaBillableMinutes * input.rates.bolnaPlatformPerMinute;
  const carrierMinutesCost = carrierBillableMinutes * input.rates.carrierPerMinute;
  const totalCost =
    voiceAiCost + bolnaPlatformCost + carrierMinutesCost + input.rates.carrierConnectionFee;

  return {
    currency: input.rates.currency,
    callCapSeconds: input.callCapSeconds,
    bolnaBillableMinutes,
    carrierBillableMinutes,
    voiceAiCost: roundMoney(voiceAiCost),
    bolnaPlatformCost: roundMoney(bolnaPlatformCost),
    carrierMinutesCost: roundMoney(carrierMinutesCost),
    carrierConnectionFee: roundMoney(input.rates.carrierConnectionFee),
    totalCost: roundMoney(totalCost),
    usesPreferredModels: input.usesPreferredModels,
  };
}

export function evaluateCanaryCostGate(input: CanaryCostGateInput): CostGateResult {
  const reasons: string[] = [];
  const { estimate } = input;

  if (!estimate.usesPreferredModels) {
    reasons.push("Non-preferred STT/LLM/TTS models require variable-rate review before a canary.");
  }
  if (
    !Number.isInteger(input.plannedCalls) ||
    input.plannedCalls < 1 ||
    input.plannedCalls > input.maxCallsPerCanary
  ) {
    reasons.push(`Planned calls must be 1 to ${input.maxCallsPerCanary}.`);
  }
  if (
    !Number.isInteger(input.maxConcurrentCalls) ||
    input.maxConcurrentCalls < 1
  ) {
    reasons.push("At least one concurrent canary call is required.");
  }
  if (estimate.totalCost > input.maxCostPerCall) {
    reasons.push(
      `Worst-case cost ${estimate.totalCost} exceeds per-call cap ${input.maxCostPerCall}.`,
    );
  }
  const projectedCanaryCost = roundMoney(estimate.totalCost * Math.max(input.plannedCalls, 0));
  if (projectedCanaryCost > input.maxCanaryCost) {
    reasons.push(
      `Projected canary cost ${projectedCanaryCost} exceeds canary cap ${input.maxCanaryCost}.`,
    );
  }

  return {
    status: reasons.length > 0 ? "FAIL" : "PASS",
    reasons,
    projectedCanaryCost,
  };
}

function requiredNumber(env: Record<string, string | undefined>, name: string): number {
  const raw = env[name]?.trim();
  if (!raw) throw new BolnaConfigError(`${name} is required for the cost gate.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new BolnaConfigError(`${name} must be numeric.`);
  return value;
}

export function loadCallCostRatesFromEnv(
  env: Record<string, string | undefined>,
): CallCostRates {
  const currency = (env.BOLNA_CANARY_CURRENCY?.trim() || "USD") as CanaryCurrency;
  const rates: CallCostRates = {
    currency,
    voiceAiPerMinute: requiredNumber(env, "BOLNA_VOICE_AI_PER_MINUTE"),
    bolnaPlatformPerMinute: requiredNumber(env, "BOLNA_PLATFORM_FEE_PER_MINUTE"),
    carrierPerMinute: requiredNumber(env, "BOLNA_CARRIER_PER_MINUTE"),
    carrierConnectionFee: requiredNumber(env, "BOLNA_CARRIER_CONNECTION_FEE"),
    carrierMinimumMinutes: Number(env.BOLNA_CARRIER_MINIMUM_MINUTES?.trim() || "0"),
    carrierBillingIncrementSeconds: Number(
      env.BOLNA_CARRIER_BILLING_INCREMENT_SECONDS?.trim() || "60",
    ),
  };
  validateCallCostRates(rates);
  return rates;
}
