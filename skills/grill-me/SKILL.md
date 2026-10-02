---
name: grill-me
description: Interview the user through the agent's native question interface when they request grill-me or consequential implementation choices remain unresolved.
---

# grill-me

Resolve the decisions that materially change the implementation. Read the
current request, prior answers and project evidence before asking anything.
Do not ask again for established preferences or authorized actions.

1. Use the native question tool actually available: `AskUserQuestion` in
   Claude Code, the host question tool in Antigravity, or the supported
   `request_user_input`/async tool in Codex. Respect mode and schema limits.
   If no interface exists, ask concise questions in the host's supported form.
2. For a broad redesign or architecture decision, cover 5–8 unresolved axes
   when they exist, in batches the tool supports. For a narrow choice, ask
   only the 1–3 questions needed. Do not create questions to meet a quota.
3. Give clear alternatives and put the recommendation first. Use multiple
   selection only when the tool supports it and the choices are combinable.
4. Explain the consequence of each choice. Separate required answers from
   optional preferences; do not use clarification as a permission prompt.
5. Continue independent research while waiting. Hold work that depends on a
   required answer until it arrives. After answers arrive, summarize the
   chosen scope once and carry the authorized task through validation.
