# Ideas to Explore

## Cross-Chat Awareness

**Origin**: Discovered accidentally on 2026-04-14 when a bug routed Surbhi's personal DMs into the self-chat, causing Claw to bridge context from two chats simultaneously. The emergent behavior was surprisingly useful.

**Problem it solves**: Plans that change in a personal DM never reach Claw, so reminders/context set via a group trigger can go stale. Nobody re-triggers @Claw to update things.

**Levels analysed** (see conversation for full scenario walkthrough):

| Level | What it adds | Cost | Trigger dependency |
|-------|-------------|------|--------------------|
| 1 — Shared global memory | VSC agent writes to `global/context.md`; self-chat agent reads it | Free (global already loaded) | None — passive notes |
| 2 — Register known contacts | Surbhi's DM JID registered; full two-way DM visible to her agent | Normal per-trigger cost | Needs trigger model (always-on = noisy) |
| 3 — Trigger-based cross-read | Running agent reads another group's recent messages when context is relevant | One extra file read in existing run | Requires a trigger in the reading group |
| 4 — Route only (no cross-read) | Agent can `send_message` to any registered JID | Near-zero | Already possible via IPC MCP |

**Key finding**: Levels 1–4 all hit the same wall — a private DM where plans change with no @Claw trigger. Only Level 2 with `requiresTrigger: false` catches it, but that makes Claw respond to every personal message, which is invasive.

**Practical next steps if revisiting**:
- Level 1 is free and worth doing — VSC agent writes a note to global after each @Claw action
- Level 2: define a trigger model for known contacts (keyword? name? explicit opt-in per contact?)
- Level 3: VSC agent detects person names in its context, pulls their DM folder's recent messages before acting
- Level 4: already works via `send_message` MCP tool with a known JID — just needs the agent to know which JIDs are available

**Unanswered question**: Is the right interface for Level 2 a custom trigger pattern per contact (e.g. Surbhi's DM only activates on her name + a keyword), or a soft always-on that only responds when there's an actionable item?
