AI Voice Sales Agent

An AI-powered outbound voice agent that calls a potential customer, conducts a natural sales conversation for an e-commerce website, understands the customer's requirements and buying intent, and triggers real-world automations during and after the call.

What this project does

The system is designed around one core workflow:

Outbound Phone Call
        ↓
   Voice Agent
        ↓
Conversation + Qualification
        ↓
  Lead State / Intent
        ↓
 ┌──────┼───────────┐
 │      │           │
HOT    WARM        COLD
 │      │           │
 ↓      ↓           ↓
WhatsApp  Callback  Log

For a high-intent lead, the system can trigger a WhatsApp automation while the call is still active. The message contains the relevant call context, resume, and contact number.

If the customer asks for a callback at a future time, the system extracts the requested time and schedules a new outbound call.

Core Requirements

The voice agent should:

Automatically place an outbound call.

Speak naturally in Telugu, Hindi, or English.

Handle conversational and mixed-language responses.

Sell e-commerce website development.

Naturally discover:

What the customer sells

Number of products

Budget

Timeline

Required features

Understand the customer's answers rather than treating the conversation as a rigid form.

Classify the lead as HOT, WARM, or COLD.

Trigger the interested-lead WhatsApp automation during the call when high buying intent is detected.

Understand callback requests such as "call me tomorrow morning."

Schedule a future callback.

Generate a contextual summary from the conversation.

Send the post-call context and required personal/professional material through WhatsApp.

Architecture

                         ┌─────────────────┐
                         │   Telephony     │
                         │    Provider     │
                         └────────┬────────┘
                                  │
                             Phone Call
                                  │
                                  ▼
                         ┌─────────────────┐
                         │     LiveKit     │
                         │   Voice Agent   │
                         └────────┬────────┘
                                  │
                     ┌────────────┼────────────┐
                     ▼            ▼            ▼
                    STT          LLM          TTS
                     │            │            │
                     └────────────┼────────────┘
                                  │
                           Conversation
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
                  RAG                     Conversation State
             "What I know"                "What they said"
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
                           Intent Detection
                                  │
                                  ▼
                         Automation Engine
                           │             │
                           ▼             ▼
                       WhatsApp       Scheduler

RAG vs Conversation State

These are intentionally separate.

RAG provides knowledge about the service:

E-commerce services

Features

Pricing

Development process

Portfolio/projects

FAQs

Conversation state stores information learned from the customer:

{
  "business": "clothing",
  "productCount": 300,
  "budget": 100000,
  "timeline": "next month",
  "features": ["Razorpay", "WhatsApp"],
  "intent": "HOT"
}

The LLM uses both the retrieved knowledge and the current conversation state to decide what to say next.

Lead Classification

HOT

The customer demonstrates strong buying intent, such as having a clear requirement, budget, timeline, or asking about pricing/start date.

Action:

HOT
 ↓
Trigger WhatsApp automation immediately
 ↓
Continue the call

WARM

The customer has a genuine requirement but has a barrier such as budget, timing, or another decision maker.

Action:

WARM
 ↓
Capture the barrier
 ↓
Schedule a callback when appropriate

COLD

The customer is only exploring or has no clear immediate requirement.

Action:

COLD
 ↓
Log the lead
 ↓
Follow up appropriately

Technology Stack

Frontend / Platform

Next.js

TypeScript

Used for the basic platform/dashboard, call controls, lead information, call history, summaries, and callback information.

Voice Agent

LiveKit Agents

TypeScript

Used for the real-time voice interaction and agent orchestration.

Telephony

Telephony provider compatible with the LiveKit setup

Responsible for placing the actual outbound phone call.

Speech-to-Text

Whisper or another low-cost/streaming STT option

The initial goal is to minimize API cost while maintaining sufficiently low latency for a live conversation.

LLM

Low-cost/free-tier LLM

The model handles conversation, extraction of lead information, intent understanding, and response generation.

RAG

PostgreSQL + pgvector

The knowledge base provides the agent with factual information about the e-commerce development service.

Database

PostgreSQL

Prisma

Neon (planned low-cost/free-tier option)

Used for leads, calls, conversation state, summaries, callback schedules, and automation events.

Automation

TypeScript tool layer

The voice agent calls explicit tools such as:

sendInterestedLeadWhatsApp()
scheduleCallback()

The AI decides when an action is appropriate; the automation layer performs the actual operation.

Project Structure

The planned structure is:

project/
├── docs/
│   ├── 01-problem-statement.md
│   ├── 02-stack-and-why.md
│   └── 03-tradeoffs.md
│
├── platform/
│   └── Next.js application
│
├── agent/
│   └── LiveKit voice agent
│
└── README.md

Development Strategy

The project will be built incrementally to reduce risk and API cost.

Phase 1 — Voice Agent

Get the basic voice conversation working:

Speech → STT → LLM → TTS

Phase 2 — Knowledge

Add the RAG knowledge base so the agent can answer questions about the e-commerce service accurately.

Phase 3 — Lead State

Extract and persist:

Business
Products
Budget
Timeline
Features
Intent

Phase 4 — Mid-call Automation

Implement:

HOT lead
   ↓
WhatsApp automation

The automation must execute while the call is still active.

Phase 5 — Callback Automation

Handle requests such as:

"Call me tomorrow morning."

Convert the natural-language request into a scheduled callback.

Phase 6 — Post-call Processing

Generate a human-readable summary based on the actual conversation and send the required information through WhatsApp.

Phase 7 — Deployment

Deploy the voice agent and platform and perform a real end-to-end outbound call.

Cost Strategy

The project is intentionally designed to use free or low-cost components wherever practical.

The main costs are expected to come from:

Actual phone minutes

WhatsApp messaging

Hosted AI/voice services where free tiers are insufficient

Development will initially be performed locally to minimize API usage. Real phone calls will be limited to focused end-to-end testing.

Engineering Principles

Keep the voice conversation natural rather than questionnaire-driven.

Keep RAG separate from conversation state.

Keep deterministic automation outside the LLM.

Trigger important actions from structured lead state.

Keep latency low enough for a real phone conversation.

Handle interruptions and code-switching.

Make failures in external services non-fatal to the conversation where possible.

Prefer simple, low-cost infrastructure over unnecessary services.

Documentation

Detailed decisions are documented in:

docs/01-problem-statement.md

docs/02-stack-and-why.md

docs/03-tradeoffs.md

Status

🚧 In development

The first milestone is to establish a reliable outbound phone call with a two-way AI voice conversation. Subsequent milestones add RAG, lead qualification, mid-call WhatsApp automation, callback scheduling, and post-call follow-up.