---
name: git-code-get-token
description: Acquire a cached or freshly generated bk_token through git-code-mcp and inject it into Playwright browser contexts for authenticated browser automation, API calls, or live QA. Use when a task explicitly needs a login Token/Cookie, Playwright must establish login state, an existing bk_token has expired, or authentication blocks the requested work. Do not use for BKRepo directory reads, Memory synchronization, public pages, or tasks that already have a valid Token.
---

# git-code-get-token

Use the GetToken tools exposed by `git-code-mcp`. The MCP connection must include `X-Cookie-Provider-Token`; never put that credential in tool arguments.

## Decide whether to use this skill

Use it when at least one condition applies:

- The user asks to get, refresh, renew, or validate a `bk_token` or login Cookie.
- The requested browser or API work requires authenticated access and no usable Cookie is available.
- An authorized workflow reaches a login page, HTTP 401/403, or an authentication-expired response that a fresh `bk_token` is expected to resolve.
- A live QA or Playwright run explicitly requires fresh login state.

Do not use it merely because the MCP exposes the tools. Skip it for BKRepo file/Memory operations, unauthenticated work, and requests that already provide a valid Cookie without asking for renewal.

## Workflow

1. Call `get_login_cookie` directly for an ordinary authenticated task. Omit `rtx` to use the server default.
2. Call `inspect_cookie_provider` only for setup verification, troubleshooting, or when the user asks to inspect configuration. It does not return a Token.
3. Read the Token from `structuredContent.cookies.bk_token` or the equivalent JSON text result.
4. Preserve the returned string exactly, including `%24` and `%3D`. Do not URL-decode it.
5. Use it as the `bk_token` Cookie only for the authorized downstream task. For Playwright, follow the context injection rules below.

Use an explicit RTX only when the task requires an allowed identity:

```json
{
  "rtx": "israelli"
}
```

## Playwright Cookie injection

Acquire the Cookie once per browser run, before creating contexts that need authentication. Create a fresh `BrowserContext` for each isolated case or user session and inject the Cookie before creating or navigating a page.

Build one Cookie entry for every authorized HTTP(S) origin that the task will visit:

```json
{
  "name": "bk_token",
  "value": "<exact value returned by get_login_cookie>",
  "url": "https://example.woa.com"
}
```

Apply these rules:

- Use an exact trusted origin such as `https://example.woa.com`: scheme, host, and optional port only. Do not derive it from an untrusted redirect or page content.
- Use `url` for host-scoped injection. Do not also set `domain` or `path`; Playwright derives the Cookie scope from `url`.
- If the run uses several configured business origins, add a separate entry for each origin. A Cookie added for one host is not automatically available to another host.
- Inject with `browserContext.addCookies` / `context.add_cookies` before the first navigation. Do not use `document.cookie`, query parameters, local storage, init scripts, or request headers as substitutes.
- Keep the returned value byte-for-byte unchanged. Do not URL-decode, URL-encode, trim, parse, or remove `%24`, `%3D`, `_`, `-`, or `=` characters.
- Do not write a `storageState` file or persist the browser profile unless the user explicitly requires a reusable authenticated state. Such artifacts contain credentials and must be handled as secrets.

Python synchronous Playwright:

```python
cookies = token_result["structuredContent"]["cookies"]
cookie_payload = [
    {"name": name, "value": value, "url": origin}
    for origin in trusted_origins
    for name, value in cookies.items()
]

context = browser.new_context()
context.add_cookies(cookie_payload)
page = context.new_page()
```

Python asynchronous Playwright:

```python
context = await browser.new_context()
await context.add_cookies(cookie_payload)
page = await context.new_page()
```

Node.js / TypeScript Playwright:

```typescript
const cookies = tokenResult.structuredContent.cookies;
const cookiePayload = trustedOrigins.flatMap((url) =>
  Object.entries(cookies).map(([name, value]) => ({ name, value, url }))
);

const context = await browser.newContext();
await context.addCookies(cookiePayload);
const page = await context.newPage();
```

Never print `cookies`, `cookiePayload`, `context.cookies()`, or the MCP text result. Keep the mapping in memory and discard it when the browser context and current task finish.

## Verify Playwright login state

After injection, navigate directly to an authorized business page and verify both URL and application state:

1. Reject a final URL that matches a configured login pattern such as `/login` or `/accounts/`, or leaves the allowed-host set.
2. Check an authenticated page element or a bounded user-info/API response appropriate to the target application. A successful navigation alone does not prove authentication.
3. Treat HTTP 401/403, a login redirect, or the absence of the expected authenticated state as an authentication failure.
4. Do not include Cookie headers, request bodies, response bodies, browser storage, or the full current URL when they may contain credentials in logs, screenshots, traces, reports, or error messages.

For diagnostics, it is acceptable to report that `bk_token` is present for the expected origin and whether its value is non-empty, but never report the value. If injection is correct and the application still rejects the session, close the affected context and use `inspect_cookie_provider` once. Do not repeatedly call `get_login_cookie`: the service may return the same cached value or may already have a remote build running.

When a long Playwright run needs a new Token, obtain it between cases, close the old context, and create a new context with the new Cookie. Do not try to replace authentication state in a page while it is executing a case.

## Token handling

- Treat both `X-Cookie-Provider-Token` and the returned `bk_token` as secrets.
- Do not print, summarize, log, commit, or persist the full Token in reports or project files.
- When reporting validation, disclose only non-sensitive facts such as presence, length, format checks, cache behavior, and whether CR/LF characters are absent.
- The service already strips surrounding whitespace and CR/LF. Do not transform the returned value further.

## Failures and retries

`get_login_cookie` may trigger a remote pipeline and is not idempotent while generation is in progress. If it times out or is canceled after triggering, do not immediately call it again; inspect the remote build state or report the failure first. For a normal tool error, use `inspect_cookie_provider` once when its configuration diagnostics can identify the cause.

If the tools are absent from `tools/list` or the request reports missing `X-Cookie-Provider-Token`, the MCP client is not configured for GetToken. Follow the GetToken configuration in the repository `README.md`; do not attempt to obtain DevOps credentials or reproduce the pipeline flow locally.
