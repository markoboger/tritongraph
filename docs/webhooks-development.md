# GitHub webhooks (development)

Production deployments should expose **`triton-runtime` over HTTPS** with a stable URL and set **`TRITON_PUBLIC_RUNTIME_URL`** to that origin so registration responses show the correct **`webhookUrl`**.

On a laptop, GitHub cannot reach `http://127.0.0.1:4317`. Use an **HTTPS tunnel** that forwards to your local runtime port.

## Option A: ngrok

1. [Install ngrok](https://ngrok.com/download).
2. Start the runtime (`npm start` in `packages/triton-runtime` or Docker Compose).
3. Run:

   ```bash
   ngrok http 4317
   ```

4. Copy the **HTTPS** forwarding URL (e.g. `https://abcd.ngrok-free.app`).
5. Set **`TRITON_PUBLIC_RUNTIME_URL`** to that origin **before** registering the webhook (so the API returns the right `webhookUrl`), or paste manually into GitHub:

   - **Payload URL:** `{PUBLIC_URL}/api/webhooks/github`
   - **Content type:** `application/json`
   - **Secret:** value returned by **`POST /api/webhooks/github/register`** (`secret` field)

6. **Private repos:** set **`TRITON_GITHUB_TOKEN`** on the runtime so pull/sync can authenticate.

## Option B: Cloudflare Tunnel (`cloudflared`)

Use Quick Tunnels or a named tunnel to publish `localhost:4317` over HTTPS. Point **`TRITON_PUBLIC_RUNTIME_URL`** at the issued URL.

## Option C: Smee.io (forwarding only)

[Smee](https://smee.io/) is useful for **inspecting** payloads. Configure GitHub to POST to a Smee URL, run the Smee client forwarding to `http://127.0.0.1:4317/api/webhooks/github`. Signature verification still uses the secret you configured in GitHub and stored via **`POST /api/webhooks/github/register`**.

## Registration API (admin)

- **`TRITON_WEBHOOK_ADMIN_TOKEN`** — When set, **`POST /api/webhooks/github/register`**, **`POST /api/webhooks/github/delete`**, and **`GET /api/webhooks/github/repos`** require header **`Authorization: Bearer <token>`**. When unset, those routes are open (convenient for local dev only).

Example register (**`workspacePath` optional** after you clone — the runtime resolves the git-cache path from **`repositoryUrl`**):

```bash
curl -sS -X POST "http://127.0.0.1:4317/api/webhooks/github/register" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TRITON_WEBHOOK_ADMIN_TOKEN" \
  -d '{"repositoryUrl":"https://github.com/org/repo.git","branch":"main"}'
```

If you pass **`workspacePath`**, it must be the **realpath** of that clone (same as the git-cache directory). In Docker with default settings, a repo like `github.com/you/chess` is typically under **`.../github-cache/github.com/you/chess`** inside the container (see **`GET /api/home`** → **`gitCacheRoot`**).

Use the **Triton home UI** → **GitHub push webhooks** → **Register repository** when you prefer not to use curl.

## Behaviour

- **One webhook URL for all repos:** GitHub uses one **payload URL** per repo; the runtime resolves the repo HTTPS URL from **`repository.clone_url`**, or **`repository.html_url` / `full_name`** when GitHub omits `clone_url` (e.g. some **ping** payloads), then matches the canonical URL to a registration.
- **Branch:** default **`main`**; configurable per registration. Only **`push`** events on **`refs/heads/<branch>`** trigger **`git pull`** (same path as **`POST /api/workspace/github/sync`**). **Ping** deliveries are acknowledged with **200** and do not run sync.

## Troubleshooting

- **400 `invalid_json`:** In the repo webhook on GitHub, set **Content type** to **`application/json`** (not *application/x-www-form-urlencoded*), unless you intentionally use the legacy `payload=` form (the runtime will try to parse that too).
- **400 `missing_repository_clone_url`:** Only on non-ping events with a malformed payload. For **ping**, the runtime returns **200** even when the payload has no resolvable repository URL.
- **401 `invalid_signature`:** The **Secret** in GitHub must match the **`secret`** from registration; re-register or fix the secret on GitHub.
