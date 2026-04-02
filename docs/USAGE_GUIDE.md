# NanoClaw Usage Guide

This guide focuses on day-to-day operation once NanoClaw is set up.

## 1) Start and verify

From repository root:

```bash
npm run dev
```

You should see startup logs indicating:
- DB initialized
- container runtime available
- channel registration/connection attempts
- scheduler + IPC loops started

If a channel is installed but not configured, it is usually skipped with a warning (expected behavior).

## 2) Core interaction model

In each chat/group, interact with your assistant using the trigger (default `@Andy`).

Examples:

- `@Andy summarize today’s chat and give me action items`
- `@Andy create a recurring reminder every weekday at 9am to review metrics`
- `@Andy join the Marketing group`

Main/private chat is typically used for control-plane actions (register groups, inspect tasks, admin operations).

## 3) Group onboarding flow

1. Ask assistant to join or register a chat/group.
2. NanoClaw creates/links a local folder under `groups/`.
3. A starter `CLAUDE.md` is created from template (main/global).
4. Future conversation and work for that group run with that folder context.

Tip: keep each group folder focused on one domain (e.g. personal ops, work backlog, family logistics).

## 4) Scheduled tasks

NanoClaw supports recurring tasks via natural-language requests interpreted by the agent.

Practical pattern:
1. Ask for a concrete schedule + outcome + delivery target.
2. Confirm by asking the assistant to list all tasks.
3. Pause/resume/remove tasks with explicit commands.

Example prompts:
- `@Andy every Monday at 08:00, summarize open PRs and send to this chat`
- `@Andy list all scheduled tasks across groups`
- `@Andy pause the weekly PR summary task`

## 5) Group memory and project memory

- **Per-group memory**: `groups/<name>/CLAUDE.md`
- **Shared guidance**: `groups/global/CLAUDE.md`
- **Main control memory**: `groups/main/CLAUDE.md`

Use these files to define tone, persistent workflows, guardrails, and domain context.

## 6) Operational commands (host shell)

- `npm run dev` — run directly from source
- `npm run build && npm start` — run compiled build
- `npm test` — run test suite
- `npm run typecheck` — TypeScript checks

## 7) Observability and troubleshooting

Recommended sequence:
1. Check logs in terminal where NanoClaw is running.
2. Ask assistant in main chat to report task/group status.
3. Review `docs/DEBUG_CHECKLIST.md`.
4. Validate runtime (Docker/Apple container) availability.

## 8) Safe customization workflow

1. Create a branch.
2. Ask Claude Code for targeted code changes.
3. Run `npm test` and `npm run typecheck`.
4. Update docs for behavior changes.

For reusable capabilities, prefer contributing as skills/branches rather than expanding base core behavior.
