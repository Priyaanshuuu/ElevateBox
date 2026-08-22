# Problem Statement

## Objective

Build an AI-powered outbound voice system that automatically calls a potential customer, conducts a natural sales conversation about e-commerce website development, understands the customer's requirements and buying intent, and takes the appropriate action while the call is still active.

The system must place the call autonomously, support Telugu, Hindi, and English, naturally discover the customer's budget, products, timeline, and required features, and classify the lead as Hot, Warm, or Cold.

## Core Requirements

1. **Place the call automatically**
   - The system must dial the provided phone number without manual dialing.

2. **Conduct a multilingual conversation**
   - The agent should speak Telugu, Hindi, or English depending on the customer's response.
   - Mixed-language speech should be handled naturally.

3. **Sell e-commerce website development**
   - The agent should explain the service conversationally rather than behaving like a recorded menu.

4. **Discover the customer's requirements**
   - Understand what the customer sells.
   - Understand the approximate number of products.
   - Ask about budget.
   - Understand the expected timeline.
   - Understand required features.

5. **Understand and classify the lead**
   - The system should infer buying intent from the customer's actual responses.
   - Classify the lead as **Hot**, **Warm**, or **Cold**.

6. **Trigger actions during the call**
   - When the customer shows high buying intent, trigger the WhatsApp automation before the call ends.
   - The automation should send the conversation context/summary, the candidate's resume, and the candidate's mobile number.

7. **Schedule callbacks from speech**
   - If the customer asks for a callback at a future time, such as "call me back tomorrow morning," the system should understand the request and schedule the callback.

8. **Follow up using actual conversation context**
   - The follow-up should reference what the customer actually discussed instead of using a generic template.

## High-Level Flow

```text
Outbound Call
      ↓
Voice Agent
      ↓
Speech → STT → LLM → TTS
      ↓
Conversation Understanding
      ↓
Lead State / Intent
      ↓
Hot / Warm / Cold
      ↓
Automation
   ├── Hot → WhatsApp during call
   ├── Warm → Capture barrier + callback
   └── Cold → Log lead / move on
      ↓
Post-call summary and follow-up
```

## Success Criteria

The prototype is successful when it can make a real outbound call without manual dialing, hold a natural two-way conversation, correctly understand the customer's requirements and buying intent, trigger the high-intent WhatsApp action during the call, schedule a callback from spoken time expressions, and produce a contextual follow-up.

The assignment evaluates the working system rather than a presentation or proposed architecture.
