import { config } from "../config.ts";
import { PgVectorRag, resolveKnowledgePath } from "./index.ts";

async function main(): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for RAG ingestion");
  }
  if (!config.embeddingApiKey) {
    throw new Error("EMBEDDING_API_KEY (or OPENAI_API_KEY) is required for RAG ingestion");
  }

  const rag = new PgVectorRag({
    databaseUrl: config.databaseUrl,
    embeddingApiKey: config.embeddingApiKey,
    embeddingEndpoint: config.embeddingEndpoint,
    embeddingModel: config.embeddingModel,
  });

  try {
    const knowledgeDir = resolveKnowledgePath(config.ragKnowledgeDir);
    const ingested = await rag.ingestFromDirectory({ knowledgeDir });
    console.log(`RAG ingestion complete. Upserted chunks: ${ingested}`);
  } finally {
    await rag.close();
  }
}

void main().catch((error: unknown) => {
  console.error("RAG ingestion failed:", error);
  process.exitCode = 1;
});
