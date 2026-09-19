# Zimail

[![Deploy this fork](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/MHibriziF/zimail)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

Self-hosted email for your own domain, running on Cloudflare Workers.
Get `you@yourdomain.com` with a full web client — no third-party mailbox,
no servers to maintain.

> **This is a fork of [DivinPrince/quickinbox](https://github.com/DivinPrince/quickinbox)**,
> the original project by [Irasubiza Divin Prince](https://github.com/DivinPrince).
> Everything below that is not marked as an addition came from there, and the
> credit for it goes there. This fork adds the features listed under
> [What this fork adds](#what-this-fork-adds).


## Features

- **Real mail in and out** — the provider delivers straight into the Worker, nothing is polled
- **Threads** — replies group into conversations, quoted history collapses; conversations never mix messages from different domains
- **Attachments** — inbound files land in R2, outbound files upload from the composer
- **Safe HTML** — received HTML renders in a sandboxed iframe
- **Multiple domains and users** — per-user addresses, admin catch-all, unrouted-mail view; the combined inbox tags each conversation with the address it arrived on and can filter by it
- **Delivery status** — delivered / bounced / complained tracking
- **REST API, CLI, and MCP server** — send and read mail from scripts, the terminal, or AI agents
- Light and dark themes

## What this fork adds

On top of everything upstream ships:

- **[Video meetings](#video-meetings-optional)** — LiveKit calls joined with a short, reusable code (`abc-defg-hij`) or its link, no account needed for guests. Camera and mic preview before joining, an optional waiting room where the host lets people in, screen sharing, background blur or replacement, picture-in-picture, a participants list and chat. **Compose → New meeting**, or the **Meetings** view.
- **Two interfaces** — Zero, the two-pane shell with a command palette and keyboard shortcuts, or Classic, the original stacked layout. Per account, in **Settings → Interface**.
- **Scheduled send** — pick any future date and time, or one of the presets, from the caret beside **Send**. The message waits in your own outbox and a [cron trigger](#scheduled-send) delivers it, so it works on either mail provider and is not capped at a provider's hold-until horizon. Recall it back to a draft any time before it goes.
- **Two-factor authentication** — TOTP from any authenticator app, with single-use backup codes, asked for at sign-in. **Settings → Two-factor authentication**.
- **Recovery address** — link a second mailbox you already own to the account. It is where security notices land and where forgotten-password links are sent, so losing access to this inbox does not lock you out of it. **Settings → Recovery address**.
- **[Migrations that apply themselves](#database-migrations)** — the Deploy to Cloudflare button never runs them, so upstream's one-click deploy lands on an empty database. Here the Worker brings its own schema up to date.
- **Broader deletion** — trash that empties itself on a retention period you choose, plus a sweep that moves mail older than a given age to the trash. Drafts and scheduled messages are never swept, and a count is always shown before anything moves. **Settings → Cleanup**.
- **Recipient chips** — To, Cc and Bcc turn what you have typed into a chip on space, comma, semicolon, <kbd>Enter</kbd> or <kbd>Tab</kbd>, so a mistyped address is visible before you send rather than after.
- **Recipient suggestions** — the composer offers addresses you have written to before as you type.
- **Time zone** — pick the zone your mail and your scheduled sends are read in, rather than trusting whatever the browser reports. **Settings → Time zone**.
- **Editable display name** — change the name recipients see on your mail without touching the database. **Settings → Account**.
- **Bahasa Indonesia**, alongside English, French, Spanish and Simplified Chinese. **Settings → Language**.

## Quick start

Click **Deploy this fork** above, or run the setup wizard locally:

```bash
bun run setup
# if bun isn't installed yet:
bash scripts/setup.sh
```

The wizard creates the D1 database and R2 bucket, writes config, and onboards
your domain. Budget about 30 minutes — most of that is waiting on DNS.

You need:

1. A domain you control
2. A [Cloudflare](https://dash.cloudflare.com) account
3. Either a [Resend](https://resend.com) account, **or** the domain on Cloudflare DNS plus a Workers paid plan

## Updating an existing install

Pulling updates does **not** rename your Worker, D1 database, or R2 bucket —
leave those as they are (often `quickmail` / `quickmail-attachments`). Existing
`qm_live_` API keys keep working, and `quickmail` remains a CLI alias.

The Worker applies any pending migrations itself on the first request after a
deploy, so `bun run deploy` is enough. To apply them ahead of time instead:

```bash
bun run db:migrate:remote
```

Both paths write to the same `d1_migrations` table, so it does not matter which
runs first.

**Coming from upstream, or from a build of this fork before scheduled send moved
to cron:** migration `0019` moves any message Resend was already holding to
`queued` and leaves Resend to release it, so nothing is sent twice. Those
messages can no longer be recalled; anything scheduled after the update can.

## Choosing a mail provider

One provider is active per deploy, selected by `EMAIL_PROVIDER` (`resend` is
the default, `cloudflare` is the alternative). Do not point the same domain's
apex MX at both.

|                 | [Resend](https://resend.com)             | [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| Outbound        | Resend API                               | Workers `env.EMAIL.send()`                                                    |
| Inbound         | Webhook → `/api/webhooks/resend`         | Worker `email()` handler                                                      |
| DNS             | Any DNS host                             | **Cloudflare DNS required**                                                   |
| Cost            | Resend free tier + Cloudflare            | Requires a **Workers paid** plan                                              |
| Delivery events | `delivered`, `bounced`, `complained`, …  | Accepted send is stored as `sent`                                             |

Pick Resend if your DNS lives elsewhere or you already use it. Pick Cloudflare
Email if the zone is already on Cloudflare and you want everything on one account.

## Manual setup

Only needed if you cannot run the wizard.

### 1. Install

```bash
bun install          # or: npm install
bunx wrangler login
```

Cloudflare Email Sending needs **Wrangler 4.123+** (older versions hit a
removed API path and 404).

### 2. Create D1 and R2

```bash
bunx wrangler d1 create quickmail
bunx wrangler r2 bucket create quickmail-attachments
```

Copy the printed `database_id` into `wrangler.jsonc` (replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`). Migrations are applied by the Worker on
its first request, so there is nothing else to run — but you can apply them up
front if you prefer:

```bash
bun run db:migrate:remote
```

To serve from your own hostname, uncomment the `routes` block in
`wrangler.jsonc` — the zone must be on the same Cloudflare account.

Then follow **exactly one** provider track below.

### Track A — Resend

1. **Verify the domain** in Resend (**Domains → Add Domain**) and add every
   record they show, including the apex `MX` — without it, mail never arrives.
   Enable **sending and receiving** on the domain.

2. **Set the API key** (create it with full access — send + domains + receiving):

   ```bash
   bunx wrangler secret put RESEND_API_KEY
   ```

3. **Deploy, then create the webhook** (the URL must be public):

   ```bash
   bun run deploy
   ```

   In [Resend → Webhooks](https://resend.com/webhooks) add a webhook pointing to
   `https://<your-worker-url>/api/webhooks/resend` with the events
   `email.received`, `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained`, `email.delivery_delayed`, `email.failed`.

4. **Save the signing secret** (shown once) and redeploy:

   ```bash
   bunx wrangler secret put RESEND_WEBHOOK_SECRET
   bun run deploy
   ```

While testing, a DMARC record on `_dmarc` is recommended:
`v=DMARC1; p=none; rua=mailto:you@yourdomain.com; pct=100; adkim=s; aspf=s`
(tighten to `p=quarantine` later).

### Track B — Cloudflare Email Service

The zone must use **Cloudflare DNS**.

1. **Onboard the domain** for both
   [Email Sending](https://dash.cloudflare.com/?to=/:account/email-service/sending)
   and [Email Routing](https://dash.cloudflare.com/?to=/:account/email-service/routing)
   in the dashboard, or with Wrangler 4.123+:

   ```bash
   bunx wrangler email sending enable yourdomain.com
   bunx wrangler email routing enable yourdomain.com
   ```

2. **Route inbound mail to the Worker.** In the Email Routing dashboard, enable
   **Catch-all** with the action **Send to a Worker** → this app. The catch-all
   is what lets users create arbitrary addresses in Settings. (This step is
   dashboard-only — the CLI can't set a Worker as the catch-all action.)

3. **Configure the Worker** in `wrangler.jsonc` and deploy:

   ```jsonc
   "vars": {
     "EMAIL_PROVIDER": "cloudflare",
     "CLOUDFLARE_MAIL_DOMAINS": "yourdomain.com" // comma-separate multiple domains
   }
   ```

   ```bash
   bun run deploy
   ```

Inbound mail only works on a **deployed** Worker (or `bun run preview`) —
`vite dev` never runs the `email()` handler.

## First run

1. Open the deployed URL.
2. Visit `/setup` — pick a domain and create the admin account (name,
   address, password). That address is both the inbox and the login.
3. Later users claim addresses through `/onboarding`.

Send yourself a message from another account — it should land within seconds.

### Desktop notifications (optional)

Zimail can push-notify users about new mail even with no tab open:

```bash
bunx web-push generate-vapid-keys
bunx wrangler secret put VAPID_PUBLIC_KEY
bunx wrangler secret put VAPID_PRIVATE_KEY
bunx wrangler secret put VAPID_SUBJECT   # e.g. mailto:admin@example.com
bun run db:migrate:remote
bun run deploy
```

Users opt in under **Settings → Desktop notifications**. Don't rotate the key
pair after users subscribe, or they'll have to re-enable.

Skip this and notifications just don't show up — nothing else depends on it.
The **Deploy this fork** button prompts for these three too, and they're
optional there as well: leave them blank and add them later the same way.

### Telegram notifications (optional)

Every inbound message can also ping a Telegram chat — useful for a mailbox you
watch from your phone without installing anything:

```bash
bunx wrangler secret put TELEGRAM_BOT_TOKEN   # from @BotFather
bunx wrangler secret put TELEGRAM_CHAT_ID     # from @userinfobot; negative for groups
bun run deploy
```

If the chat is a forum supergroup, add `TELEGRAM_THREAD_ID` for the topic to
post into — without it Telegram puts the message in General. Add `APP_URL` to
`vars` in `wrangler.jsonc` to link your install from each notification. Both secrets are required — leave either unset and notifications
stay off. This works on both provider tracks, and mail that matched no mailbox
is announced too, so a missing route is visible instead of silent.

Each message arrives as a single rich message — subject, sender, the body in
an expandable quote, every attachment inline with its size, and a link straight
to the conversation. That needs Bot API 10.1; against an older API the call
fails and the notification falls back to a text card followed by the files.

Delivery is fire-and-forget: a Telegram outage is logged and ignored rather
than failing the inbound handler, which the provider would then retry.

### Video meetings (optional)

Zimail can start LiveKit video calls from **Compose** or the **Meetings**
view — guests join from the shared link with no account, with a camera/mic
preview, screen sharing, a participants list, and chat.

1. Create a project at [LiveKit Cloud](https://cloud.livekit.io) and copy its
   API key, API secret, and `wss://` URL from **Settings → Keys**.
2. Set them as Worker secrets:

```bash
bunx wrangler secret put LIVEKIT_API_KEY
bunx wrangler secret put LIVEKIT_API_SECRET
bunx wrangler secret put LIVEKIT_URL
```

Skip this and meetings just don't show up — nothing else depends on it. The
**Deploy this fork** button prompts for these three too, and they're optional
there as well: leave them blank and add them later the same way.

## Database migrations

*Changed by this fork.*

Upstream leaves the schema to `wrangler d1 migrations apply`, which the **Deploy
to Cloudflare** button never runs — so a one-click deploy lands on an empty
database and fails until someone knows to migrate it by hand.

Here the migration files are bundled into the Worker and any pending ones are
applied on the first request (and by the `email()` and cron handlers, whichever
arrives first). They are recorded in `d1_migrations` — wrangler's own table, in
wrangler's own format — so the CLI and the Worker agree about what has run and
either can go first.

Each migration is sent as a single D1 batch together with the row recording it,
so it lands whole or not at all, and two requests hitting a cold deploy at once
cannot apply anything twice.

## Scheduled send

*Added by this fork.*

A scheduled message is stored unsent in D1 — nothing is handed to the mail
provider until its time comes. A [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
declared in `wrangler.jsonc` runs the Worker every minute and sends whatever is
due:

```jsonc
"triggers": {
  "crons": ["* * * * *"]
}
```

Nothing to configure — `bun run deploy` registers the trigger. Because the app
holds the message rather than the provider, scheduling works on **both**
providers and the send time can be as far out as you like.

A message that the provider rejects is retried on the next two ticks and then
marked failed, with the provider's reason on the message. Recalling one from
the thread view turns it back into a draft, and only works while it is still
waiting — once the sweep has picked it up, it is on its way.

Under `vite dev` the Worker never runs, so the trigger never fires; a page load
sweeps the signed-in user's own due messages instead, which keeps scheduling
testable locally. On a deployed Worker the trigger has already been round and
that check costs one indexed query.

## Development

```bash
cp .dev.vars.example .dev.vars    # fill in the provider you're using
bun install
bun run db:migrate:local
bun run dev
```

| Command           | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| `bun run dev`     | Vite dev server (D1/R2 via platformProxy)                |
| `bun run preview` | Production build + `wrangler dev` (Cloudflare inbound)   |
| `bun run check`   | svelte-check                                             |
| `bun run test`    | Unit tests                                               |
| `bun run deploy`  | Build, wrap the Worker with `email()`, deploy            |

**Testing inbound with Resend:** webhooks can't reach `localhost`, so tunnel it
(`cloudflared tunnel --url http://localhost:5173`) and point a **throwaway**
webhook at the tunnel — never repoint production.

**Testing inbound with Cloudflare Email:** use `bun run preview` or a deploy.

**Forgot the admin password:**

```bash
bun scripts/reset-admin-password.mjs you@example.com newpassword --local
```

## API access

Any user can mint a long-lived API key under **Settings → API keys** and use it
as a bearer token:

```sh
curl https://your-worker/api/mail \
  -H "Authorization: Bearer qi_live_..." \
  -H "Content-Type: application/json" \
  -d '{"to": "you@example.com", "subject": "hello", "text": "hi"}'
```

`GET /api/mail?view=inbox` lists conversations. Keys are scoped (`mail:read`,
`mail:send`, admin) and only the SHA-256 hash is stored — the raw value is
shown once. Revoking a key takes effect immediately. New keys start with
`qi_live_`; existing `qm_live_` keys keep working after you pull this update.

## CLI and MCP

```bash
curl -fsSL https://raw.githubusercontent.com/MHibriziF/zimail/main/scripts/install.sh | sh
quickinbox login --url https://<your-instance> --token <key from Settings>
quickinbox inbox
quickinbox send --to someone@example.com --subject "Hi" --body "Hello"
```

The same credentials drive an MCP server for Claude, Cursor, and other agents:

```json
{
  "mcpServers": {
    "quickinbox": {
      "command": "quickinbox",
      "args": ["mcp"],
      "env": {
        "QUICKINBOX_URL": "https://mail.example.com",
        "QUICKINBOX_TOKEN": "qi_live_…"
      }
    }
  }
}
```

`quickinbox` is the launcher from the install script (`~/.local/bin/quickinbox`).
`quickmail` is the same binary. Login once, or set `QUICKINBOX_URL` and
`QUICKINBOX_TOKEN` as above (`QUICKMAIL_URL` / `QUICKMAIL_TOKEN` still work).

Tools: `list_threads`, `get_thread`, `search_mail`, `send_message`, `reply`,
`list_attachments`.

## How inbound routing works

Both providers accept every address on a connected domain. The app then routes:

1. Exact match in `addresses` → that user
2. Else the domain's catch-all owner (admin) → that user
3. Else stored as unrouted and listed in the admin view

## Project structure

```
src/
  worker.ts          SvelteKit fetch + Cloudflare email() inbound + scheduled() send
  routes/            inbox, compose, drafts, settings, admin, setup
  lib/
    components/      sidebar, mailbox, composer, thread view
    server/          providers, inbound, D1, auth
scripts/
  setup.sh / setup.mjs         first-run wizard
  wrap-cloudflare-worker.mjs   attach email() after the SvelteKit build
cli/                 quickinbox CLI + MCP server
migrations/          D1 schema, applied in order
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `wrangler email sending enable` → 404 | Wrangler too old — upgrade to 4.123+ |
| Mail never arrives (Resend) | `dig MX yourdomain.com` must point at Resend; enable receiving on the domain |
| Mail never arrives (Cloudflare) | Apex MX must be Cloudflare Routing, catch-all must target this Worker, `EMAIL_PROVIDER=cloudflare`, Worker must be deployed |
| Webhook 401 | `RESEND_WEBHOOK_SECRET` mismatch — secrets are shown once; recreate the webhook |
| Webhook 500 | `bunx wrangler tail` |
| Attachments missing | R2 bucket must exist and match `bucket_name` in `wrangler.jsonc` |
| `database_id` errors on deploy | Paste the id from `wrangler d1 create` into `wrangler.jsonc` |
| Setup shows no Cloudflare domains | Set `CLOUDFLARE_MAIL_DOMAINS` and `EMAIL_PROVIDER=cloudflare`, restart the dev server |

## License

[MIT](LICENSE.md) — use it, modify it, ship it, commercially or not.
Copyright © 2026 Irasubiza Divin Prince, original author of
[quickinbox](https://github.com/DivinPrince/quickinbox), from which this fork
descends and under whose licence it is redistributed.
