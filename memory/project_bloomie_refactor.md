---
name: bloomie_chatbot_refactor_2026
description: Major Bloomie chatbot architecture refactor - stale buttons, conversational responses, typing indicator, topic interrupt
type: project
---

In March 2026, completed a major Bloomie chatbot refactor touching 4 files and adding 1 new test file.

**Why:** The chatbot had a stale button bug where old "Yes/No" buttons from a previous flow could re-activate after the user changed topics. Responses also exposed internal medical reasoning labels ("Possible situation:", "What this may mean:") directly to users rather than producing natural prose.

**Changes made:**
- bloomie-templates.js: Rewrote buildGuidanceResponse() to produce conversational output - no section headers exposed to user. Lines merge situation+meaning into one opener, next steps use a natural starter phrase, urgent signs use "One thing to watch for:" framing.
- bloomie-session.js: Added isTyping (bool) and flowId (int) to createCtx() shape.
- assistant.js: Fixed stale button bug via two mechanisms: (1) keepLocked:true in say() when a transition is scheduled after, so UI stays locked during the gap; (2) data-flow="${ctx.flowId}" on each rendered button, checked on click to discard stale buttons. Also: added typing indicator (bubble--typing with animated dots), injected CSS via style tag, added topic interrupt detection (clears entityHistory when primary topic bucket changes, e.g. period→pain), expanded ELSE_INTRO with 7 choices including pregnancy/fertility, body changes, irregular cycle, added ELSE_BODY_CHANGES node, improved NARROWING to include discharge path.
- __tests__/bloomie-intent-flow.test.js: New test file covering template format (no headers), topic interrupt detection, safety escalation priority, flowId stale guard, response composer shape.
- __tests__/bloomie-templates.test.js: Updated 3 tests to match new format ("one thing to watch for" instead of "seek urgent help if", "educational info" instead of "educational information only").

**How to apply:** When touching Bloomie chat logic, remember the flowId guard is the stale button defense - any button click handler must check data-flow matches ctx.flowId. The keepLocked pattern in say() is needed any time a transition is scheduled after say() completes.
