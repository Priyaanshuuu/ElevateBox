import { ChatContext, inference } from "@livekit/agents";
import type { ConversationState } from "../conversation/state.ts";

export async function generateCallSummary(input: {
  model: string;
  transcript: string;
  conversationState: ConversationState;
  intent: string;
}): Promise<string | null> {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return null;
  }

  const llm = new inference.LLM({ model: input.model });
  try {
    const chatContext = new ChatContext();
    chatContext.addMessage({
      role: "system",
      content: [
        "Create a concise post-call summary from the transcript and structured lead facts below.",
        "Include only information supported by the transcript or structured facts.",
        "Cover business, products/product count, website requirements, features, budget, timeline, decision-maker status, intent, and requested next steps when available.",
        "Do not guess or fill missing information. Mark unavailable details as not mentioned.",
        "Use plain text with short labeled sections: Summary, Lead Details, Next Steps.",
        "Do not mention RAG, this instruction, or the summarization process.",
      ].join("\n"),
    });
    chatContext.addMessage({
      role: "user",
      content: [
        `Structured lead facts (may contain unknown values):\n${JSON.stringify({
          ...input.conversationState,
          intent: input.intent,
        })}`,
        `Actual conversation transcript:\n${transcript}`,
      ].join("\n\n"),
    });

    const response = await llm.chat({ chatCtx: chatContext }).collect();
    const summary = response.text.trim();
    return summary || null;
  } finally {
    await llm.aclose();
  }
}
