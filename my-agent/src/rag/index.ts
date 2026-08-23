import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { Pool } from "pg";

export interface RagChunk {
  source: string;
  chunkIndex: number;
  content: string;
}

export interface RagRetrievedChunk extends RagChunk {
  similarity: number;
}

export interface RagOptions {
  databaseUrl: string;
  embeddingApiKey: string;
  embeddingEndpoint: string;
  embeddingModel: string;
}

export interface RagIngestOptions {
  knowledgeDir: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export class PgVectorRag {
  private readonly pool: Pool;
  private readonly embeddingApiKey: string;
  private readonly embeddingEndpoint: string;
  private readonly embeddingModel: string;

  constructor(options: RagOptions) {
    this.pool = new Pool({ connectionString: options.databaseUrl });
    this.embeddingApiKey = options.embeddingApiKey;
    this.embeddingEndpoint = options.embeddingEndpoint;
    this.embeddingModel = options.embeddingModel;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id BIGSERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding VECTOR(1536) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(source, chunk_index)
      )
    `);
  }

  async ingestFromDirectory(options: RagIngestOptions): Promise<number> {
    await this.ensureSchema();

    const chunkSize = options.chunkSize ?? 1200;
    const chunkOverlap = options.chunkOverlap ?? 150;

    const files = await listTextFiles(options.knowledgeDir);
    let total = 0;

    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      const relative = path.relative(options.knowledgeDir, file).replaceAll("\\", "/");
      const chunks = splitText(content, chunkSize, chunkOverlap).map((text, idx) => ({
        source: relative,
        chunkIndex: idx,
        content: text,
      }));

      for (const chunk of chunks) {
        const embedding = await this.embedText(chunk.content);
        const vectorLiteral = toVectorLiteral(embedding);
        const contentHash = sha256(chunk.content);
        await this.pool.query(
          `
            INSERT INTO knowledge_chunks (source, chunk_index, content, content_hash, embedding)
            VALUES ($1, $2, $3, $4, $5::vector)
            ON CONFLICT (source, chunk_index)
            DO UPDATE SET content = EXCLUDED.content,
                          content_hash = EXCLUDED.content_hash,
                          embedding = EXCLUDED.embedding
          `,
          [chunk.source, chunk.chunkIndex, chunk.content, contentHash, vectorLiteral],
        );
        total += 1;
      }
    }

    return total;
  }

  async retrieve(query: string, topK: number): Promise<RagRetrievedChunk[]> {
    await this.ensureSchema();
    const embedding = await this.embedText(query);
    const vectorLiteral = toVectorLiteral(embedding);

    const result = await this.pool.query<{
      source: string;
      chunk_index: number;
      content: string;
      similarity: number;
    }>(
      `
        SELECT
          source,
          chunk_index,
          content,
          1 - (embedding <=> $1::vector) AS similarity
        FROM knowledge_chunks
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `,
      [vectorLiteral, topK],
    );

    return result.rows.map((row) => ({
      source: row.source,
      chunkIndex: row.chunk_index,
      content: row.content,
      similarity: row.similarity,
    }));
  }

  private async embedText(input: string): Promise<number[]> {
    const response = await fetch(this.embeddingEndpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.embeddingApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.embeddingModel,
        input,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error("Embedding request failed: " + response.status + " " + body);
    }

    const json = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    const embedding = json.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error("Embedding response did not include embedding data");
    }

    return embedding;
  }
}

export function formatRagContext(chunks: RagRetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "";
  }

  return chunks
    .map(
      (chunk, idx) =>
        `[Doc ${idx + 1}] ${chunk.source} (score=${chunk.similarity.toFixed(3)})\n${chunk.content}`,
    )
    .join("\n\n");
}

async function listTextFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && isKnowledgeFile(fullPath)) {
        out.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return out;
}

function isKnowledgeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".txt";
}

function splitText(content: string, chunkSize: number, overlap: number): string[] {
  const cleaned = content.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    const end = Math.min(start + chunkSize, cleaned.length);
    const chunk = cleaned.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= cleaned.length) {
      break;
    }
    start = Math.max(end - overlap, 0);
  }

  return chunks;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveKnowledgePath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}
