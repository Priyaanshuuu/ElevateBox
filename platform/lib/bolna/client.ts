import { loadBolnaConfig, type BolnaConfig } from "./config.ts";
import {
  BolnaConfigError,
  BolnaHttpError,
  BolnaNetworkError,
  BolnaResponseError,
  BolnaTimeoutError,
  redactSecrets,
} from "./errors.ts";
import {
  parseBolnaAgentCreateResponse,
  parseBolnaAgentVersionListResponse,
  parseBolnaAgentVersionSaveResponse,
  parseBolnaAgentVersionSetCurrentResponse,
  parseBolnaCallResponse,
  type BolnaAgentCreateResponse,
  type BolnaAgentRequestV2,
  type BolnaAgentVersionListResponse,
  type BolnaAgentVersionRequestV2,
  type BolnaAgentVersionSaveResponse,
  type BolnaAgentVersionSetCurrentResponse,
  type BolnaCallRequest,
  type BolnaCallResponse,
} from "./agent-types.ts";
import {
  parseBolnaBulkDispositionsResponse,
  parseBolnaDispositionCreateResponse,
  parseBolnaDispositionTestResponse,
  parseBolnaExtractionCategory,
  parseBolnaExtractionCategoryListResponse,
  type BolnaBulkDispositionsRequest,
  type BolnaBulkDispositionsResponse,
  type BolnaDispositionCreateRequest,
  type BolnaDispositionCreateResponse,
  type BolnaDispositionTestRequest,
  type BolnaDispositionTestResponse,
  type BolnaExtractionCategory,
  type BolnaExtractionCategoryCreate,
  type BolnaExtractionCategoryListResponse,
} from "./extraction-types.ts";
import {
  parseBolnaExecutionSnapshot,
  parseBolnaUser,
  type BolnaExecutionSnapshot,
  type BolnaUser,
} from "./types.ts";
import {
  parseBolnaKnowledgeBase,
  parseBolnaKnowledgeBaseDeleteResponse,
  parseBolnaKnowledgeBaseListResponse,
  type BolnaKnowledgeBase,
  type BolnaKnowledgeBaseDeleteResponse,
  type BolnaKnowledgeBaseListResponse,
} from "./knowledge-types.ts";
import {
  BOLNA_CALLBACK_MAX_BODY_BYTES,
  BOLNA_CALLBACK_SIGNATURE_HEADER,
  parseBolnaWorkflowCallbackDelivery,
  parseBolnaWorkflowCallbackEndpoint,
  signBolnaCallbackBody,
  type BolnaWorkflowCallbackDelivery,
  type BolnaWorkflowCallbackEndpoint,
} from "./callback-types.ts";
import {
  buildAgentTelephonyPatchRequest,
  parseBolnaAgentPatchResponse,
  parseBolnaTrunk,
  parseBolnaTrunkCallListResponse,
  parseBolnaTrunkConnectionDetails,
  parseBolnaTrunkListResponse,
  parseBolnaTrunkNumber,
  parseBolnaTrunkGateway,
  parseBolnaTrunkCarrierIp,
  serializeTrunkCreateRequest,
  serializeTrunkNumberRequest,
  type BolnaAgentPatchResponse,
  type BolnaCarrierIpRequest,
  type BolnaTelephonyProvider,
  type BolnaTrunk,
  type BolnaTrunkCallListResponse,
  type BolnaTrunkCarrierIp,
  type BolnaTrunkConnectionDetails,
  type BolnaTrunkCreateRequest,
  type BolnaTrunkGateway,
  type BolnaTrunkListResponse,
  type BolnaTrunkNumber,
  type BolnaTrunkNumberRequest,
  type BolnaTrunkCallFilter,
} from "./trunk-types.ts";

export interface BolnaClientOptions {
  config?: BolnaConfig;
  fetchImpl?: typeof fetch;
}

export type BolnaKnowledgeSourceInput =
  | { kind: "url"; url: string }
  | { kind: "pdf"; fileName: string; bytes: Uint8Array };

export interface BolnaKnowledgeCreateInput {
  source: BolnaKnowledgeSourceInput;
  chunkSize?: number;
  similarityTopK?: number;
  overlapping?: number;
  languageSupport?: "multilingual";
}

export interface BolnaClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  request<T>(path: string, init?: RequestInit, secrets?: readonly string[]): Promise<T>;
  getUser(): Promise<BolnaUser>;
  createAgent(request: BolnaAgentRequestV2): Promise<BolnaAgentCreateResponse>;
  saveAgentVersion(
    agentId: string,
    request: BolnaAgentVersionRequestV2,
  ): Promise<BolnaAgentVersionSaveResponse>;
  listAgentVersions(
    agentId: string,
    options?: { pageNumber?: number; pageSize?: number },
  ): Promise<BolnaAgentVersionListResponse>;
  setCurrentAgentVersion(
    agentId: string,
    versionId: string,
  ): Promise<BolnaAgentVersionSetCurrentResponse>;
  getExecution(executionId: string): Promise<BolnaExecutionSnapshot>;
  createExtractionCategory(
    agentId: string,
    request: BolnaExtractionCategoryCreate,
  ): Promise<BolnaExtractionCategory>;
  listExtractionCategories(
    agentId: string,
  ): Promise<BolnaExtractionCategoryListResponse>;
  createDisposition(
    request: BolnaDispositionCreateRequest,
  ): Promise<BolnaDispositionCreateResponse>;
  createDispositionsBulk(
    request: BolnaBulkDispositionsRequest,
  ): Promise<BolnaBulkDispositionsResponse>;
  testDispositions(
    agentId: string,
    request: BolnaDispositionTestRequest,
  ): Promise<BolnaDispositionTestResponse>;
  createKnowledgeBase(input: BolnaKnowledgeCreateInput): Promise<BolnaKnowledgeBase>;
  listKnowledgeBases(): Promise<BolnaKnowledgeBaseListResponse>;
  getKnowledgeBase(ragId: string): Promise<BolnaKnowledgeBase>;
  deleteKnowledgeBase(ragId: string): Promise<BolnaKnowledgeBaseDeleteResponse>;
  getWorkflowCallback(
    workflowId: string,
    nodeId: string,
  ): Promise<BolnaWorkflowCallbackEndpoint>;
  rotateWorkflowCallback(
    workflowId: string,
    nodeId: string,
  ): Promise<BolnaWorkflowCallbackEndpoint>;
  postWorkflowCallback(
    endpoint: BolnaWorkflowCallbackEndpoint,
    body: string,
  ): Promise<BolnaWorkflowCallbackDelivery>;
  listTrunks(): Promise<BolnaTrunkListResponse>;
  getTrunk(trunkId: string): Promise<BolnaTrunk>;
  createTrunk(request: BolnaTrunkCreateRequest): Promise<BolnaTrunk>;
  getTrunkConnectionDetails(): Promise<BolnaTrunkConnectionDetails>;
  listTrunkCalls(
    trunkId: string,
    options?: { direction?: BolnaTrunkCallFilter; limit?: number; number?: string },
  ): Promise<BolnaTrunkCallListResponse>;
  addTrunkGateway(
    trunkId: string,
    request: { host: string; port?: number; priority?: number },
  ): Promise<BolnaTrunkGateway>;
  addTrunkCarrierIp(trunkId: string, request: BolnaCarrierIpRequest): Promise<BolnaTrunkCarrierIp>;
  addTrunkNumber(
    trunkId: string,
    request: BolnaTrunkNumberRequest,
  ): Promise<BolnaTrunkNumber>;
  assignTrunkAgent(
    numberId: string,
    agentId: string | null,
  ): Promise<BolnaTrunkNumber>;
  patchAgentTelephonyProvider(
    agentId: string,
    provider: BolnaTelephonyProvider,
  ): Promise<BolnaAgentPatchResponse>;
  makeCall(request: BolnaCallRequest): Promise<BolnaCallResponse>;
}

function buildUrl(baseUrl: string, path: string): URL {
  return new URL(path.replace(/^\/+/, ""), `${baseUrl}/`);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

async function readErrorSnippet(response: Response, secrets: readonly string[]): Promise<string> {
  try {
    const text = await response.text();
    return redactSecrets(text, secrets).replace(/\s+/g, " ").trim().slice(0, 2000);
  } catch {
    return "";
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new BolnaResponseError("Bolna returned a non-JSON response.", { cause });
  }
}

export function createBolnaClient(options: BolnaClientOptions = {}): BolnaClient {
  const config = options.config ?? loadBolnaConfig();
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    init: RequestInit = {},
    secrets: readonly string[] = [],
  ): Promise<T> {
    const url = buildUrl(config.baseUrl, path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${config.apiKey}`);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (
      init.body !== undefined &&
      !headers.has("Content-Type") &&
      !(typeof FormData !== "undefined" && init.body instanceof FormData)
    ) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (cause) {
      if (isTimeoutError(cause)) {
        throw new BolnaTimeoutError(`Bolna request timed out after ${config.timeoutMs}ms.`, {
          cause,
        });
      }
      throw new BolnaNetworkError("Bolna request failed before a response was received.", {
        cause,
      });
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response, [config.apiKey, ...secrets]);
      const retryable = response.status === 429 || response.status >= 500;
      throw new BolnaHttpError(
        `Bolna request failed with status ${response.status}${snippet ? `: ${snippet}` : ""}.`,
        { status: response.status, retryable },
      );
    }

    return await parseJsonResponse<T>(response);
  }

  function postJson(
    path: string,
    body: unknown,
    secrets: readonly string[] = [],
  ): Promise<unknown> {
    return request<unknown>(
      path,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      secrets,
    );
  }

  function patchJson(path: string, body: unknown): Promise<unknown> {
    return request<unknown>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async function postSignedCallback(
    endpoint: BolnaWorkflowCallbackEndpoint,
    body: string,
  ): Promise<BolnaWorkflowCallbackDelivery> {
    if (Buffer.byteLength(body, "utf8") > BOLNA_CALLBACK_MAX_BODY_BYTES) {
      throw new BolnaConfigError("Bolna callback body exceeds 262144 bytes.");
    }
    const signature = signBolnaCallbackBody(body, endpoint.signingSecret);
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      [BOLNA_CALLBACK_SIGNATURE_HEADER]: signature,
    });

    let response: Response;
    try {
      response = await fetchImpl(endpoint.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (cause) {
      if (isTimeoutError(cause)) {
        throw new BolnaTimeoutError(`Bolna callback timed out after ${config.timeoutMs}ms.`, {
          cause,
        });
      }
      throw new BolnaNetworkError("Bolna callback failed before a response was received.", {
        cause,
      });
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response, [config.apiKey, endpoint.signingSecret, endpoint.url]);
      const retryable = response.status === 429 || response.status >= 500;
      throw new BolnaHttpError(
        `Bolna callback failed with status ${response.status}${snippet ? `: ${snippet}` : ""}.`,
        { status: response.status, retryable },
      );
    }

    return parseBolnaWorkflowCallbackDelivery(await parseJsonResponse<unknown>(response));
  }

  return {
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    request,
    async getUser() {
      return parseBolnaUser(await request<unknown>("/user/me"));
    },
    async createAgent(agentRequest) {
      return parseBolnaAgentCreateResponse(await postJson("/v2/agent", agentRequest));
    },
    async saveAgentVersion(agentId, versionRequest) {
      const path = `/v2/agent/${encodeURIComponent(agentId)}/versions`;
      return parseBolnaAgentVersionSaveResponse(await postJson(path, versionRequest));
    },
    async listAgentVersions(agentId, options = {}) {
      const query = new URLSearchParams({
        page_number: String(options.pageNumber ?? 1),
        page_size: String(options.pageSize ?? 20),
      });
      const path = `/v2/agent/${encodeURIComponent(agentId)}/versions?${query.toString()}`;
      return parseBolnaAgentVersionListResponse(await request<unknown>(path));
    },
    async setCurrentAgentVersion(agentId, versionId) {
      const path = `/v2/agent/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}/set_current`;
      return parseBolnaAgentVersionSetCurrentResponse(await postJson(path, {}));
    },
    async getExecution(executionId) {
      const path = `/executions/${encodeURIComponent(executionId)}`;
      return parseBolnaExecutionSnapshot(await request<unknown>(path));
    },
    async createExtractionCategory(agentId, categoryRequest) {
      const path = `/agent/${encodeURIComponent(agentId)}/extraction-categories`;
      return parseBolnaExtractionCategory(await postJson(path, categoryRequest));
    },
    async listExtractionCategories(agentId) {
      const path = `/agent/${encodeURIComponent(agentId)}/extraction-categories`;
      return parseBolnaExtractionCategoryListResponse(await request<unknown>(path));
    },
    async createDisposition(dispositionRequest) {
      return parseBolnaDispositionCreateResponse(await postJson("/dispositions/", dispositionRequest));
    },
    async createDispositionsBulk(bulkRequest) {
      return parseBolnaBulkDispositionsResponse(await postJson("/dispositions/bulk", bulkRequest));
    },
    async testDispositions(agentId, testRequest) {
      const path = `/v2/agent/${encodeURIComponent(agentId)}/dispositions/test`;
      return parseBolnaDispositionTestResponse(await postJson(path, testRequest));
    },
    async createKnowledgeBase(input) {
      const form = new FormData();
      if (input.source.kind === "url") {
        form.set("url", input.source.url);
      } else {
        form.set(
          "file",
          new Blob([new Uint8Array(input.source.bytes)], { type: "application/pdf" }),
          input.source.fileName,
        );
      }
      if (input.chunkSize !== undefined) form.set("chunk_size", String(input.chunkSize));
      if (input.similarityTopK !== undefined) {
        form.set("similarity_top_k", String(input.similarityTopK));
      }
      if (input.overlapping !== undefined) form.set("overlapping", String(input.overlapping));
      if (input.languageSupport !== undefined) {
        form.set("language_support", input.languageSupport);
      }
      return parseBolnaKnowledgeBase(await request<unknown>("/knowledgebase", { method: "POST", body: form }));
    },
    async listKnowledgeBases() {
      return parseBolnaKnowledgeBaseListResponse(await request<unknown>("/knowledgebase/all"));
    },
    async getKnowledgeBase(ragId) {
      const path = `/knowledgebase/${encodeURIComponent(ragId)}`;
      return parseBolnaKnowledgeBase(await request<unknown>(path));
    },
    async deleteKnowledgeBase(ragId) {
      const path = `/knowledgebase/${encodeURIComponent(ragId)}`;
      return parseBolnaKnowledgeBaseDeleteResponse(
        await request<unknown>(path, { method: "DELETE" }),
      );
    },
    async getWorkflowCallback(workflowId, nodeId) {
      const path = `/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/callback`;
      return parseBolnaWorkflowCallbackEndpoint(await request<unknown>(path));
    },
    async rotateWorkflowCallback(workflowId, nodeId) {
      const path = `/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/callback:rotate`;
      return parseBolnaWorkflowCallbackEndpoint(await postJson(path, {}));
    },
    async postWorkflowCallback(endpoint, body) {
      return postSignedCallback(endpoint, body);
    },
    async listTrunks() {
      return parseBolnaTrunkListResponse(await request<unknown>("/trunk/trunks"));
    },
    async getTrunk(trunkId) {
      const path = `/trunk/trunks/${encodeURIComponent(trunkId)}`;
      return parseBolnaTrunk(await request<unknown>(path));
    },
    async createTrunk(trunkRequest) {
      const body = serializeTrunkCreateRequest(trunkRequest);
      const secrets = typeof body.auth_password === "string" ? [body.auth_password] : [];
      return parseBolnaTrunk(await postJson("/trunk/trunks", body, secrets));
    },
    async getTrunkConnectionDetails() {
      return parseBolnaTrunkConnectionDetails(await request<unknown>("/trunk/pop"));
    },
    async listTrunkCalls(trunkId, options = {}) {
      const query = new URLSearchParams();
      if (options.direction) query.set("direction", options.direction);
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.number) query.set("number", options.number);
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      const path = `/trunk/trunks/${encodeURIComponent(trunkId)}/calls${suffix}`;
      return parseBolnaTrunkCallListResponse(await request<unknown>(path));
    },
    async addTrunkGateway(trunkId, gatewayRequest) {
      const path = `/trunk/trunks/${encodeURIComponent(trunkId)}/gateways`;
      return parseBolnaTrunkGateway(await postJson(path, gatewayRequest));
    },
    async addTrunkCarrierIp(trunkId, carrierIpRequest) {
      const path = `/trunk/trunks/${encodeURIComponent(trunkId)}/ip-acls`;
      return parseBolnaTrunkCarrierIp(await postJson(path, carrierIpRequest));
    },
    async addTrunkNumber(trunkId, numberRequest) {
      const path = `/trunk/trunks/${encodeURIComponent(trunkId)}/numbers`;
      const body = serializeTrunkNumberRequest(numberRequest);
      return parseBolnaTrunkNumber(await postJson(path, body));
    },
    async assignTrunkAgent(numberId, agentId) {
      const path = `/trunk/numbers/${encodeURIComponent(numberId)}`;
      return parseBolnaTrunkNumber(await patchJson(path, { agent_id: agentId }));
    },
    async patchAgentTelephonyProvider(agentId, provider) {
      const path = `/v2/agent/${encodeURIComponent(agentId)}`;
      return parseBolnaAgentPatchResponse(await patchJson(path, buildAgentTelephonyPatchRequest(provider)));
    },
    async makeCall(callRequest) {
      return parseBolnaCallResponse(await postJson("/call", callRequest));
    },
  };
}
