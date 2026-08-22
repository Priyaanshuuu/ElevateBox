# Architectural Trade-offs

## 1. LiveKit vs Building the Voice Pipeline Directly

### Decision
Use **LiveKit Agents** for the voice-agent layer and a telephony provider for the actual phone connection.

### Why
A voice call has real-time requirements: low latency, interruptions, audio streaming, and two-way communication. LiveKit provides infrastructure for the real-time agent loop so the project can focus on the sales logic and automation.

### Trade-off
This introduces another platform into the architecture and requires understanding LiveKit's telephony/SIP integration. A completely custom audio pipeline could provide more control, but would increase implementation complexity and risk for an assignment whose main evaluation is whether the live system works.

---

## 2. Whisper vs Paid/Hosted STT

### Decision
Start with **Whisper** to minimize transcription costs.

### Why
Whisper is open-source and can be self-hosted, making it attractive for a low-cost prototype.

### Trade-off
Self-hosted Whisper may have higher latency than a purpose-built streaming STT service. This matters because the assignment explicitly evaluates real-time conversation, interruptions, and multilingual/code-switched speech.

### Decision rule
If Whisper cannot provide sufficiently low latency or reliable Telugu/Hindi/English transcription in testing, replace it with a streaming STT provider rather than sacrificing call quality to keep the system free.

---

## 3. Free/Low-Cost LLM vs More Expensive Models

### Decision
Start with a free-tier or low-cost LLM.

### Why
The agent's task is relatively bounded: conduct a sales conversation, extract requirements, reason about buying intent, use retrieved service information, and decide when to call tools.

### Trade-off
A smaller/cheaper model may be weaker at ambiguous customer statements, multilingual code-switching, and nuanced intent classification.

### Decision rule
Use the lowest-cost model that reliably handles the live conversation. The evaluation is based on behavior, not on using an expensive model.

---

## 4. PostgreSQL + pgvector vs a Dedicated Vector Database

### Decision
Use **PostgreSQL + pgvector** for RAG.

### Why
The knowledge base is small, so a dedicated vector database would add infrastructure without providing meaningful value. PostgreSQL can store the application data and embeddings together.

### Trade-off
A dedicated vector database can provide specialized retrieval features and scale better for large knowledge bases. That complexity is unnecessary for this assignment.

---

## 5. RAG vs Conversation Memory

### Decision
Keep RAG and conversation state separate.

### Why
RAG answers questions such as "What services do I offer?" Conversation state answers questions such as "What budget did the customer just mention?"

### Trade-off
Maintaining both systems adds some implementation work, but combining them would make lead qualification and automation harder to reason about.

### Example

```text
RAG:
"Razorpay integration is supported."

Conversation State:
"Customer has 300 products and a ₹1 lakh budget."

Automation:
"Customer is HOT → send WhatsApp."
```

---

## 6. LLM-Driven Actions vs Explicit Tools

### Decision
Expose external actions as explicit tools/functions rather than allowing the LLM to directly perform side effects.

Examples:

```text
sendInterestedLeadWhatsApp()
scheduleCallback()
```

### Why
The LLM decides **when** an action is appropriate, while application code controls **how** the action is executed.

### Trade-off
This requires more explicit schemas and state management, but makes the system safer, testable, and easier to debug.

---

## 7. Fixed Questionnaire vs Natural Discovery

### Decision
Use a qualification schema instead of forcing the agent through ten rigid questions.

### Why
The assignment requires the questions to be asked naturally. A customer may answer several qualification points in one sentence.

### Trade-off
A dynamic conversation is harder to implement and test than a fixed questionnaire, but it produces a much more natural call and better matches the evaluation criteria.

---

## 8. Pay for Everything vs Optimize for Cost

### Decision
Use free/open-source components wherever they are good enough and pay only for services that materially improve the live demonstration, particularly telephony and potentially multilingual STT/TTS.

### Why
The assignment permits API, voice-minute, WhatsApp, and hosting expenses, but the prototype does not need large-scale production infrastructure.

### Trade-off
Free components may require more engineering effort and can have weaker latency or voice quality. The final choice should be driven by the quality of the actual phone call rather than by cost alone.
