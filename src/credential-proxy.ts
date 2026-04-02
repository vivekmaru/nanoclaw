/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Features:
 *   - API key injection (single or comma-separated for auto-failover)
 *   - OAuth token injection for subscription-based auth
 *   - Model name remapping for third-party API providers
 *   - Automatic key rotation on rate-limit errors
 *
 * Multi-key failover:
 *   Set ANTHROPIC_API_KEY=key1,key2,key3 in .env. When the active key
 *   hits a rate limit, the proxy retries the same request with the next
 *   key. Rotation is transparent to containers.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

/** Build a model remapping table from .env (MODEL_MAP JSON). */
function buildModelMap(): Map<string, string> {
  const env = readEnvFile(['MODEL_MAP']);
  if (!env.MODEL_MAP) return new Map();
  try {
    const parsed = JSON.parse(env.MODEL_MAP) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    logger.warn('MODEL_MAP in .env is not valid JSON — ignoring');
    return new Map();
  }
}

/** Check if a response body indicates a rate-limit error. */
function isRateLimitError(
  statusCode: number,
  body: string,
): boolean {
  if (statusCode === 429) return true;
  // z.ai uses 200 with error code in body, or non-standard codes
  try {
    const json = JSON.parse(body);
    if (json.error?.code === '1308') return true;
    if (json.error?.type === 'rate_limit_error') return true;
  } catch {
    // Not JSON — can't detect
  }
  return false;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  // Parse comma-separated API keys for auto-failover
  const apiKeys: string[] = (secrets.ANTHROPIC_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  const authMode: AuthMode = apiKeys.length > 0 ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  // Preserve any path prefix from the base URL (e.g. /api/anthropic)
  const basePath = upstreamUrl.pathname.replace(/\/$/, '');

  const modelMap = buildModelMap();

  // Track active key index for rotation
  let activeKeyIndex = 0;

  if (apiKeys.length > 1) {
    logger.info(
      { keyCount: apiKeys.length },
      'API key auto-failover enabled',
    );
  }

  /**
   * Forward a request upstream with a specific API key.
   * Buffers the response to detect rate-limit errors for retry.
   */
  function forwardRequest(
    reqUrl: string,
    method: string,
    headers: Record<string, string | number | string[] | undefined>,
    body: Buffer,
    keyIndex: number,
    res: import('http').ServerResponse,
    retryCount: number,
  ): void {
    const requestHeaders = { ...headers };
    if (authMode === 'api-key') {
      requestHeaders['x-api-key'] = apiKeys[keyIndex];
    }

    const upstream = makeRequest(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttps ? 443 : 80),
        path: basePath + reqUrl,
        method,
        headers: requestHeaders,
      } as RequestOptions,
      (upRes) => {
        const statusCode = upRes.statusCode!;

        // Successful responses: stream through directly without buffering.
        // Buffering breaks SSE streaming which Claude Code SDK requires.
        if (statusCode >= 200 && statusCode < 300) {
          if (!res.headersSent) {
            res.writeHead(statusCode, upRes.headers);
          }
          upRes.pipe(res);
          return;
        }

        // Error responses: buffer to check for rate-limit errors before forwarding
        const resChunks: Buffer[] = [];
        upRes.on('data', (c: Buffer) => resChunks.push(c));
        upRes.on('end', () => {
          const resBody = Buffer.concat(resChunks).toString('utf-8');

          // Check for rate-limit — retry with next key if available
          if (
            isRateLimitError(statusCode, resBody) &&
            retryCount < apiKeys.length - 1
          ) {
            const nextKeyIndex = (keyIndex + 1) % apiKeys.length;
            logger.info(
              {
                fromKey: keyIndex,
                toKey: nextKeyIndex,
                statusCode,
              },
              'Rate limit hit — rotating API key',
            );
            activeKeyIndex = nextKeyIndex;
            forwardRequest(
              reqUrl,
              method,
              headers,
              body,
              nextKeyIndex,
              res,
              retryCount + 1,
            );
            return;
          }

          // Non-rate-limit error or all keys exhausted — forward as-is
          if (!res.headersSent) {
            res.writeHead(statusCode, upRes.headers);
          }
          res.end(resBody);
        });
      },
    );

    upstream.on('error', (err) => {
      logger.error({ err, url: reqUrl }, 'Credential proxy upstream error');
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
    });

    upstream.write(body);
    upstream.end();
  }

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // Remove placeholder — real key injected per-request in forwardRequest
          delete headers['x-api-key'];
        } else {
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        // Remap model names in request body if MODEL_MAP is configured
        if (modelMap.size > 0 && body.length > 0) {
          try {
            const json = JSON.parse(body.toString('utf-8'));
            if (json.model && modelMap.has(json.model)) {
              const original = json.model;
              json.model = modelMap.get(original);
              body = Buffer.from(JSON.stringify(json), 'utf-8');
              headers['content-length'] = body.length;
              logger.debug(
                { from: original, to: json.model },
                'Remapped model name',
              );
            }
          } catch {
            // Not JSON or no model field — pass through as-is
          }
        }

        forwardRequest(
          req.url!,
          req.method!,
          headers,
          body,
          activeKeyIndex,
          res,
          0,
        );
      });
    });

    server.listen(port, host, () => {
      logger.info(
        {
          port,
          host,
          authMode,
          modelRemap: modelMap.size > 0,
          keyCount: apiKeys.length || undefined,
        },
        'Credential proxy started',
      );
      resolve(server);
    });

    server.on('error', reject);
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
