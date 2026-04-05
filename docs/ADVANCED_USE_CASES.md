# NanoClaw Advanced Use Cases

This document shows higher-leverage patterns for power users.

## 1) Multi-group operating model (personal + team)

**Goal:** Keep strict context boundaries while coordinating high-level execution.

Pattern:
- Main chat: orchestration and policy commands.
- Work group(s): engineering or GTM workflows.
- Personal group: private planning and reminders.

Why it works:
- Per-group folders and sessions isolate context.
- Trigger policy can limit when non-main groups run.

## 2) Autonomous weekly operating cadence

**Goal:** Turn routine reporting into scheduled agent tasks.

Example cadence:
- Monday: priorities + risk register update.
- Daily: KPI digest at fixed time.
- Friday: changelog/readme drift review from git history.

Implementation tips:
- Keep each task explicit on data sources and output format.
- Ask assistant to include “what changed since last run.”
- Periodically audit task list and remove stale automations.

## 3) Repository maintenance assistant

**Goal:** Use a dedicated group mapped to a repo checkout for semi-autonomous maintenance.

Typical jobs:
- dependency/security scan summaries
- docs drift detection
- release-note draft generation
- issue triage summaries

Guardrails:
- require trigger in non-main groups
- use PR-based workflow for code changes
- keep credentials proxied (Agent Vault) and principle of least privilege

## 4) Research and briefing pipeline

**Goal:** Create recurring external research briefs.

Pattern:
1. Scheduled task gathers updates from selected sources.
2. Output constrained to fixed sections (highlights, implications, actions).
3. Deliver into main chat for review.

Best practice:
- Prefer stable source lists.
- Ask for source-attributed summaries.
- Add “confidence/uncertainty” section.

## 5) Cross-channel command center

**Goal:** Operate from multiple messaging channels without losing unified orchestration.

Pattern:
- Install channels as needed via skills.
- Keep main admin control in one channel.
- Use channel ownership/routing to respond on the originating channel.

Operational note:
- Missing credentials should gracefully disable that channel at startup.

## 6) Secure filesystem augmentation

**Goal:** Give a group limited access to external project/data directories.

Pattern:
- Mount only required folders for that group.
- Keep sensitive stores in separate unmapped paths.
- Audit mounts regularly.

Use cases:
- read-only reporting over analytics exports
- docs maintenance over a project tree
- changelog generation from a code repo

## 7) Custom skill branches for organization-specific behavior

**Goal:** Maintain a lean base fork while layering specialized capabilities.

Pattern:
- Build feature as skill branch.
- Merge skill into selected forks/groups only.
- Keep upstream sync easier by minimizing core divergence.

Examples:
- proprietary ticketing connector
- domain-specific response formatting
- internal escalation workflow

## 8) Failure-mode playbook

When automation quality drops:
1. Inspect recent logs and task outputs.
2. Validate runtime/container health.
3. Confirm group memory (`CLAUDE.md`) did not drift.
4. Reduce task scope and reintroduce complexity incrementally.

Use `docs/DEBUG_CHECKLIST.md` for a structured troubleshooting sequence.
