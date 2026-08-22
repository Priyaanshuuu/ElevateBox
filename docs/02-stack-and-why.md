# Technology Stack and Why

## Stack Overview

| Layer | Technology | Why |
|---|---|---|
| Web platform | Next.js + TypeScript | Provides a simple dashboard/control surface and backend API routes while keeping the project in one TypeScript ecosystem. |
| Voice agent | LiveKit Agents | Handles the real-time voice-agent layer and provides the foundation for a conversational phone agent. |
| Telephony | Twilio | Provides the connection between the application and the public telephone network for outbound calls. |
| Speech-to-text | Whisper (initial choice) | Open-source STT option that can reduce per-minute transcription costs when self-hosted. |
| LLM | Low-cost/free-tier LLM | Keeps inference costs low while handling conversation, requirement extraction, intent reasoning, and response generation. |
| Text-to-speech | Low-cost/free-tier multilingual TTS | Converts the generated responses back into speech while keeping development costs low. |
| Database | PostgreSQL | Stores leads, calls, conversation state, summaries, callback jobs, and automation events. |
| ORM | Prisma | Type-safe database access from the TypeScript backend. |
| RAG | PostgreSQL + pgvector | Keeps the knowledge base in the existing database instead of introducing another vector database. |
| Automation | TypeScript tool layer | Keeps actions such as WhatsApp and callback scheduling explicit and separate from conversational reasoning. |
| WhatsApp | WhatsApp Business API/provider | Sends the high-intent message during the call and the required follow-up information. |
| Deployment | Vercel + LiveKit Cloud / suitable low-cost agent hosting | Keeps the web platform and voice infrastructure simple to deploy while minimizing cost. |

## Architecture

```text
                         Phone
                           │
                           ▼
                    ┌─────────────┐
                    │   Twilio    │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   LiveKit   │
                    │    Agent    │
                    └──────┬──────┘
                           │
                    STT → LLM → TTS
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
          RAG / Knowledge            Lead State
             │                           │
             └─────────────┬─────────────┘
                           ▼
                    Intent Detection
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
            HOT          WARM          COLD
             │             │             │
             ▼             ▼             ▼
         WhatsApp      Scheduler       Log
         mid-call      callback        lead
```

## Design Principle

The system separates three concerns:

- **RAG:** what the agent knows about the e-commerce development service.
- **Conversation/lead state:** what the customer has said during the call.
- **Automation:** what should happen when a business condition is satisfied.

The LLM uses the current conversation state and relevant RAG context to decide what to say next. Deterministic tools perform external actions such as sending WhatsApp messages and scheduling callbacks.

## Cost Strategy

The project is intentionally designed around free or low-cost components wherever practical. The framework, application code, PostgreSQL/pgvector, Prisma, and initial development can be run with little or no direct cost. Real outbound telephony and WhatsApp delivery may incur usage charges, so those services should be used selectively for live testing and the final demonstration.

The assignment explicitly allows spending on APIs, voice minutes, WhatsApp, hosting, and tools and states that expenses are reimbursed if the candidate joins.
