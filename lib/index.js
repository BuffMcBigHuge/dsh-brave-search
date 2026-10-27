/**
 * Brave Search provider for DeepSeek Harness.
 *
 * Registers a single `brave` search provider on `ctx.web`. There is no settings
 * card and no per-call configuration: the API key is resolved once per search
 * from the host's credential service, then from the managed credentials
 * document, then from the ambient environment.
 *
 * Mount it by adding this entry to a profile patch (see README), then select it:
 *
 *   - id: web
 *     config:
 *       searchProvider: brave
 *
 * Requires a Brave Search API key (free tier: 2,000 queries/month):
 * https://api-dashboard.search.brave.com/
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Brave's web search endpoint. */
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
/** Credential reference the key is stored under. */
const REF = 'BRAVE_API_KEY';
/** Per-request ceiling; Brave also caps `count` at 20. */
const TIMEOUT_MS = 15000;
const USER_AGENT = 'dsh-brave-search/1.0.0';
/** Brave's latency window tokens for the harness `filters.recency` values. */
const FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };

/** The credentials document the host manages. */
function credentialsPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml');
}

/**
 * Resolve the API key: credential service, then the credentials document
 * itself, then the ambient environment.
 *
 * @param {{ get: (name: string) => unknown }} ctx - host context.
 * @returns the key, or undefined when no source holds one.
 */
async function resolveKey(ctx) {
  try {
    const credentials = ctx.get('credentials');
    const resolved = await credentials?.resolve?.(REF);
    if (typeof resolved?.value === 'string' && resolved.value.length > 0) return resolved.value;
  } catch {
    /* no credential service mounted; fall through */
  }

  try {
    const text = await readFile(credentialsPath(), 'utf8');
    // `refs:` is a flat two-space-indented mapping of REF: value.
    const match = text.match(/^\s{2}BRAVE_API_KEY:[ \t]*["']?([^"'\n#]+?)["']?[ \t]*$/m);
    const value = match?.[1]?.trim();
    if (value) return value;
  } catch {
    /* document unreadable; fall through */
  }

  const env = process.env[REF]?.trim();
  return env && env.length > 0 ? env : undefined;
}

/**
 * Map a Brave payload onto the harness source shape. Every optional field is
 * omitted when absent so the result stays lossless JSON for the tool layer.
 *
 * @param {unknown} data - parsed Brave response.
 * @param {number} maxResults - hard cap on returned sources.
 * @returns {Array<{ url: string, title?: string, snippet?: string, publishedAt?: string }>}
 */
export function toSources(data, maxResults) {
  const results = data?.web?.results;
  const sources = [];
  if (!Array.isArray(results)) return sources;

  for (const item of results) {
    if (sources.length >= maxResults) break;
    if (typeof item?.url !== 'string' || item.url.length === 0) continue;

    sources.push({
      url: item.url,
      ...(typeof item.title === 'string' && item.title ? { title: item.title } : {}),
      ...(typeof item.description === 'string' && item.description ? { snippet: item.description } : {}),
      ...(typeof item.age === 'string' && item.age ? { publishedAt: item.age } : {}),
    });
  }
  return sources;
}

export const name = 'brave-search';
export const inject = ['web'];

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.web.registerSearchProvider({
    id: 'brave',

    available() {
      return true;
    },

    async search(request, signal) {
      const key = await resolveKey(ctx);
      if (!key) {
        throw new Error(
          `brave: no ${REF} found — store it in the credential service, ${credentialsPath()}, or the environment`,
        );
      }

      const query = String(request?.query ?? '').trim();
      if (!query) throw new Error('brave: empty query');

      const count = Math.min(Math.max(Number(request?.maxResults) || 8, 1), 20);
      const url = new URL(ENDPOINT);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(count));

      const freshness = FRESHNESS[request?.filters?.recency];
      if (freshness) url.searchParams.set('freshness', freshness);

      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

      const response = await fetch(url, {
        signal: composed,
        headers: {
          'X-Subscription-Token': key,
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        const hint = response.status === 429 ? ' (rate limited: Brave free tier is 2,000 queries/month)' : '';
        throw new Error(`brave: HTTP ${response.status}${hint}${detail ? ` — ${detail}` : ''}`);
      }

      return { sources: toSources(await response.json(), count), truncated: false };
    },
  });
}
