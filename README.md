# dsh-brave-search

A Brave Search provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

One backend, one job: send the query to Brave's Web Search API and hand the
results back through `ctx.web`. No settings card, no multi-backend fan-out, no
state. If you have ever wanted `web_search` to just be Brave, this is that.

- Single `fetch` to `https://api.search.brave.com/res/v1/web/search`
- Key resolved from the credential service, then `$DSH_HOME/.credentials.yaml`, then the environment
- Honors `maxResults` and the harness's `recency` filter; caps at Brave's `count=20`
- Clear failures: missing key, non-2xx, and the 429 free-tier ceiling

## Requirements

- DeepSeek Harness with the `web` service (any profile that mounts `@deepseek-ai/dsh-web`)
- A Brave Search API key — free tier is 2,000 queries/month: <https://api-dashboard.search.brave.com/>

## Install

```bash
dsh plugin --profile web add github:BuffMcBigHuge/dsh-brave-search
```

The package ships its own bundle patch, so the provider is mounted automatically.

## Point `web_search` at it

Add this to your profile patch (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: web
  name: "@deepseek-ai/dsh-web"
  config:
    searchProvider: brave
```

> **Careful:** a patch entry's `config` **replaces** the entry's config object
> rather than merging into it. If your profile already sets `fetchProvider`
> (or anything else on `web`), repeat it in the same block — omitting it drops
> the setting and you will get `multiple usable web providers are registered`.

## Store the key

Through the credential store, by hand:

```yaml
# $DSH_HOME/.credentials.yaml
version: 1
refs:
  BRAVE_API_KEY: your-key-here
```

Keep that file at `chmod 600` — the credential provider refuses to load a
document readable beyond its owner. An environment variable works too:

```bash
BRAVE_API_KEY=… dsh web
```

## Verify

Ask for a search. No telemetry line is printed; the results themselves are the
signal. A misconfigured key surfaces as `brave: HTTP 401`, and a missing one as
`brave: no BRAVE_API_KEY found — …`.

## How it differs from a multi-backend plugin

It registers exactly one provider (`brave`), so provider selection is
unambiguous once `searchProvider` is set. There is no fallback: if Brave is
down or rate-limited, the search fails rather than silently answering from
another engine.

## Development

```bash
node --test test/
```

## License

MIT
