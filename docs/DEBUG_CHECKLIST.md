# NanoClaw Debug Checklist

## Known Issues (2026-02-08)

### 1. [FIXED] Resume branches from stale tree position
When agent teams spawns subagent CLI processes, they write to the same session JSONL. On subsequent `query()` resumes, the CLI reads the JSONL but may pick a stale branch tip (from before the subagent activity), causing the agent's response to land on a branch the host never receives a `result` for. **Fix**: pass `resumeSessionAt` with the last assistant message UUID to explicitly anchor each resume.

### 2. IDLE_TIMEOUT == CONTAINER_TIMEOUT (both 30 min)
Both timers fire at the same time, so containers always exit via hard SIGKILL (code 137) instead of graceful `_close` sentinel shutdown. The idle timeout should be shorter (e.g., 5 min) so containers wind down between messages, while container timeout stays at 30 min as a safety net for stuck agents.

### 3. Cursor advanced before agent succeeds
`processGroupMessages` advances `lastAgentTimestamp` before the agent runs. If the container times out, retries find no messages (cursor already past them). Messages are permanently lost on timeout.

### 4. Kubernetes image garbage collection deletes nanoclaw-agent image

**Symptoms**: `Container exited with code 125: pull access denied for nanoclaw-agent` — the container image disappears overnight or after a few hours, even though you just built it.

**Cause**: If your container runtime has Kubernetes enabled (Rancher Desktop enables it by default), the kubelet runs image garbage collection when disk usage exceeds 85%. NanoClaw containers are ephemeral (run and exit), so `nanoclaw-agent:latest` is never protected by a running container. The kubelet sees it as unused and deletes it — often overnight when no messages are being processed. Other images (docker-compose services) survive because they have long-running containers referencing them.

**Fix**: Disable Kubernetes if you don't need it:
```bash
# Rancher Desktop
rdctl set --kubernetes-enabled=false

# Then rebuild the container image
./container/build.sh
```

**Diagnosis**: Check the k3s log for image GC activity:
```bash
grep -i "nanoclaw" ~/Library/Logs/rancher-desktop/k3s.log
# Look for: "Removing image to free bytes" with the nanoclaw-agent image ID
```

Check NanoClaw logs for image status:
```bash
grep -E "image found|image NOT found|image missing" logs/nanoclaw.log
```

If you need Kubernetes enabled, set `CONTAINER_IMAGE` to an image stored in a registry that the kubelet won't GC, or raise the GC thresholds.

## 5. [FIXED] Third-party API providers — model remapping, path prefix, and streaming

When using a third-party Anthropic-compatible API (e.g. z.ai, OpenRouter) instead of `api.anthropic.com`, three issues surface in the credential proxy.

### Symptoms

- `"There's an issue with the selected model (claude-sonnet-4-6). It may not exist or you may not have access to it."` — the container agent fails on every message
- `"API Error: terminated"` — the agent connects but the response stream is cut short
- 404 responses from the upstream API (nginx default page)

### Root Causes and Fixes

**1. Path prefix stripped from base URL**

The credential proxy extracted only the hostname from `ANTHROPIC_BASE_URL`. If the base URL has a path component (e.g. `https://api.z.ai/api/anthropic`), the `/api/anthropic` prefix was lost. Requests went to `api.z.ai/v1/messages` instead of `api.z.ai/api/anthropic/v1/messages`.

**Fix**: The proxy now preserves the base URL path prefix (`basePath`) and prepends it to every forwarded request:
```typescript
const basePath = upstreamUrl.pathname.replace(/\/$/, '');
// ...
path: basePath + req.url,  // /api/anthropic/v1/messages
```

**2. Model name mismatch**

Claude Code SDK inside containers sends standard model names like `claude-sonnet-4-6`. Third-party providers use different names (e.g. `glm-5.1`). The proxy needs to remap model names in request bodies.

**Fix**: Add `MODEL_MAP` to `.env`:
```bash
MODEL_MAP={"claude-sonnet-4-6":"glm-5.1","claude-haiku-4-5-20251001":"glm-4.6","claude-opus-4-6":"glm-5.1"}
```
The proxy parses this JSON and rewrites the `model` field in every request body before forwarding.

**3. Response buffering breaks SSE streaming**

The auto-failover feature buffered all responses to detect rate-limit errors before forwarding. But Claude Code SDK uses `"stream": true` (SSE) — it expects chunks arriving incrementally. Buffering the entire response and sending it as a single blob caused the SDK to interpret it as a terminated stream.

**Fix**: The proxy now uses a split strategy:
- **2xx responses**: Stream through immediately via `upRes.pipe(res)` — preserves SSE
- **Error responses (4xx/5xx)**: Buffer fully, check for rate limits, retry with next key if needed

### Configuration

```bash
# .env — third-party API with multiple keys for auto-failover
ANTHROPIC_API_KEY=key1,key2,key3
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
MODEL_MAP={"claude-sonnet-4-6":"glm-5.1","claude-haiku-4-5-20251001":"glm-4.6"}
```

### Diagnosis

```bash
# Test the upstream API directly (bypass proxy)
curl -s -X POST "https://api.z.ai/api/anthropic/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $YOUR_KEY" \
  -d '{"model":"glm-5.1","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'

# Check proxy logs for key rotation and model remapping
grep -E 'Rate limit|rotating|Remapped model|upstream error' logs/nanoclaw.log | tail -10

# Check if proxy detects multiple keys
grep 'keyCount' logs/nanoclaw.log | tail -3

# Test the proxy directly (from the host)
curl -v -X POST http://172.17.0.1:3001/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: placeholder" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

### What to Watch For

- **New Claude model names**: When Anthropic releases new models (e.g. `claude-sonnet-5-0`), add them to `MODEL_MAP` in `.env` or the proxy will forward the unmapped name
- **Streaming protocol changes**: If a provider doesn't support SSE streaming, the proxy's streaming path will fail. Check with `curl` first
- **Rate-limit detection gaps**: `isRateLimitError()` checks for HTTP 429 and specific JSON error codes (`1308` for z.ai, `rate_limit_error` type for Anthropic). New providers may use different error formats — extend the detection function in `credential-proxy.ts`
- **Path prefix changes**: If the provider changes their URL structure, update `ANTHROPIC_BASE_URL` in `.env`
- **Container env vars**: The container only sees `ANTHROPIC_BASE_URL=http://host.docker.internal:3001` (the proxy URL) and `ANTHROPIC_API_KEY=placeholder`. All real routing happens in the proxy

## Quick Status Check

```bash
# 1. Is the service running?
launchctl list | grep nanoclaw
# Expected: PID  0  com.nanoclaw (PID = running, "-" = not running, non-zero exit = crashed)

# 2. Any running containers?
docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep nanoclaw

# 3. Any stopped/orphaned containers?
docker ps -a --format '{{.Names}} {{.Status}}' 2>/dev/null | grep nanoclaw

# 4. Recent errors in service log?
grep -E 'ERROR|WARN' logs/nanoclaw.log | tail -20

# 5. Are channels connected? (look for last connection event)
grep -E 'Connected|Connection closed|connection.*close|channel.*ready' logs/nanoclaw.log | tail -5

# 6. Are groups loaded?
grep 'groupCount' logs/nanoclaw.log | tail -3
```

## Session Transcript Branching

```bash
# Check for concurrent CLI processes in session debug logs
ls -la data/sessions/<group>/.claude/debug/

# Count unique SDK processes that handled messages
# Each .txt file = one CLI subprocess. Multiple = concurrent queries.

# Check parentUuid branching in transcript
python3 -c "
import json, sys
lines = open('data/sessions/<group>/.claude/projects/-workspace-group/<session>.jsonl').read().strip().split('\n')
for i, line in enumerate(lines):
  try:
    d = json.loads(line)
    if d.get('type') == 'user' and d.get('message'):
      parent = d.get('parentUuid', 'ROOT')[:8]
      content = str(d['message'].get('content', ''))[:60]
      print(f'L{i+1} parent={parent} {content}')
  except: pass
"
```

## Container Timeout Investigation

```bash
# Check for recent timeouts
grep -E 'Container timeout|timed out' logs/nanoclaw.log | tail -10

# Check container log files for the timed-out container
ls -lt groups/*/logs/container-*.log | head -10

# Read the most recent container log (replace path)
cat groups/<group>/logs/container-<timestamp>.log

# Check if retries were scheduled and what happened
grep -E 'Scheduling retry|retry|Max retries' logs/nanoclaw.log | tail -10
```

## Agent Not Responding

```bash
# Check if messages are being received from channels
grep 'New messages' logs/nanoclaw.log | tail -10

# Check if messages are being processed (container spawned)
grep -E 'Processing messages|Spawning container' logs/nanoclaw.log | tail -10

# Check if messages are being piped to active container
grep -E 'Piped messages|sendMessage' logs/nanoclaw.log | tail -10

# Check the queue state — any active containers?
grep -E 'Starting container|Container active|concurrency limit' logs/nanoclaw.log | tail -10

# Check lastAgentTimestamp vs latest message timestamp
sqlite3 store/messages.db "SELECT chat_jid, MAX(timestamp) as latest FROM messages GROUP BY chat_jid ORDER BY latest DESC LIMIT 5;"
```

## Container Mount Issues

```bash
# Check mount validation logs (shows on container spawn)
grep -E 'Mount validated|Mount.*REJECTED|mount' logs/nanoclaw.log | tail -10

# Verify the mount allowlist is readable
cat ~/.config/nanoclaw/mount-allowlist.json

# Check group's container_config in DB
sqlite3 store/messages.db "SELECT name, container_config FROM registered_groups;"

# Test-run a container to check mounts (dry run)
# Replace <group-folder> with the group's folder name
docker run -i --rm --entrypoint ls nanoclaw-agent:latest /workspace/extra/
```

## Channel Auth Issues

```bash
# Check if QR code was requested (means auth expired)
grep 'QR\|authentication required\|qr' logs/nanoclaw.log | tail -5

# Check auth files exist
ls -la store/auth/

# Re-authenticate if needed
npm run auth
```

## Service Management

```bash
# Restart the service
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# View live logs
tail -f logs/nanoclaw.log

# Stop the service (careful — running containers are detached, not killed)
launchctl bootout gui/$(id -u)/com.nanoclaw

# Start the service
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.plist

# Rebuild after code changes
npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```
