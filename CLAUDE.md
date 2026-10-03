# Zimail

Self-hosted email on Cloudflare Workers (SvelteKit 2 + Svelte 5 runes, D1, R2).
A fork of [DivinPrince/quickinbox](https://github.com/DivinPrince/quickinbox) with
**no shared git history** — every upstream sync is a manual port, not a merge.

This file covers what isn't obvious from the code. For structure and call paths,
query the CodeGraph index (`.codegraph/` exists) instead of grepping.

## Commands

```sh
bun install          # never npm — it leaves bun.lock stale and the Cloudflare build fails
bun test             # node:test + assert/strict
bun run check        # svelte-kit sync && svelte-check
bun run build        # regenerates migrations, then vite build
```

## Things that will bite you

**Adding a migration.** Write `migrations/00NN_name.sql`, then run
`bun scripts/generate-migrations.mjs`. The Worker applies its own migrations at
runtime (the Cloudflare deploy button never migrates), so the SQL has to be
inlined into `src/lib/server/migrations/migrations.generated.ts`. That file is
committed, and `migrations.generated.test.ts` fails if it drifts.

**`allowJs`/`checkJs` are off on purpose.** The repo has no `.js` sources, and
enabling them let svelte-check follow `src/worker.ts`'s import into
`.svelte-kit/output` and report ~2,800 errors from the built bundle as soon as
a build existed. That import is suppressed with `@ts-ignore`, not
`@ts-expect-error`: whether it resolves depends on whether a build exists, so
`@ts-expect-error` becomes an error itself once one does. See issue #39.

**Verify in workerd, not vite.** `vite build` and `wrangler deploy --dry-run`
both pass while the deploy is broken. Real verification is `wrangler dev` plus
`wrangler d1 execute DB --local --command "..."` for new SQL.

**Remote D1 commands may need the database name, not `DB`.** `wrangler.jsonc`
has no IDs (#130). Without one, Wrangler resolves `DB` on the command line to a
database named `<worker name>-db`, which is what a fresh install gets. An install
whose database has another name, such as one set up before #130, passes the
name instead: `wrangler d1 execute <database name> --remote`. Deploys are
unaffected, because they inherit the live Worker's bindings. `--local` always
works with `DB`.

**Don't edit the `DB` and `ATTACHMENTS` binding lines in `wrangler.jsonc`.** The
Deploy to Cloudflare button appends each install's database and bucket IDs to
those exact lines in its copy. A change to them upstream conflicts with every
such copy on its next sync (`scripts/sync-upstream.sh`). Add new keys on their
own lines instead.

**CRLF.** The working tree is CRLF. Any script that rewrites `messages/*.json`
or a source file must detect and restore the original line endings, or the diff
becomes the whole file. `generate-migrations.mjs` normalizes to LF on purpose —
CI checks out LF and would otherwise mismatch.

**Stored timestamps are UTC with no zone.** `datetime('now')` / `CURRENT_TIMESTAMP`
write `2026-09-29 15:06:00`, which `new Date()` reads as *local* time — hours off
by the reader's offset. Parse them with `parseTimestamp()` from `$lib/utils/date`
and format in `$page.data.timeZone ?? undefined`.

**Heredocs in Bash are unreliable here.** Multi-line content and regexes get
mangled. Write the script with the Write tool and run it with node, or use Edit.

**`gh` may default to the parent repository**, since this repo is a fork. Pass
`--repo <owner>/<repo>` for the repository you mean.

## Conventions

**Server modules** (`src/lib/server/<area>/`) are three files: `repository.ts`
(raw D1, no rules), `service.ts` (rules, returns outcome unions like
`'invalid_name' | 'duplicate_name'` rather than throwing), and `index.ts` (the
composition root — `getXService(platform)`). Peer modules get an
`xServiceForDb(db)` facade rather than reaching into the repository.

**Two UI themes**, and a feature needs both: Classic in `src/lib/components/`
(with `Sidebar.svelte`) and Zero in `src/themes/zero/` (own icon set, `--z-*`
CSS variables).

**i18n**: every user-facing string goes in all five of
`messages/{en,id,fr,es,zh-CN}.json`.

**Mail rules are conversation-level.** Spam, labels and inbox tabs key on
`COALESCE(thread_id, id)`. A folder lists a conversation if any message matches;
replies inherit the conversation's state; classifier verdicts apply only to
conversation starters.

**Meet: the host is the identity, never an attribute.** Participant attributes
are self-editable, so a guest can set `role: 'host'`. Use `isHostIdentity()`
from `src/lib/meet/host-identity.ts` for every host check.

**Issues and PRs follow the templates** in `.github/ISSUE_TEMPLATE/` (bug,
feature, research) and `.github/pull_request_template.md`. `gh issue create
--body` skips the forms, so write the body with the same sections.

## CI

Checks must pass before merge: Check & test, CodeQL, GitGuardian, and a
**SonarQube quality gate that fails on any new violation**. Sonar's recurring
complaints are nested ternaries, `replace` where `replaceAll` fits, regexes it
scores as too complex (prefer word lists), and functions over its complexity
threshold. PR-Agent leaves AI review suggestions — apply the good ones, then
squash-merge once everything is green.

Run `bun test && bun run check` before pushing; it is cheaper than learning
these from a red check.

**A conflicting PR gets no CI at all.** If checks never appear after a push,
check `gh pr view N --json mergeable` first. When a PR conflicts with `main`,
GitHub can't build `refs/pull/N/merge`, so every `pull_request` workflow
silently never runs — no queued run, no failure, nothing to re-run. It looks
identical to Actions dropping the event. Rebase on `main`; closing and
reopening the PR or pushing a new SHA won't help.

## Scope

Keep it free. Prefer a local implementation over a paid service — labels, spam
and inbox tabs were all built as local rules for exactly this reason. Never send
mail content to a third party without asking first.

AI features run on Workers AI (`src/lib/server/ai/`), on the same Cloudflare
account as the mail, within the free 10,000 neurons a day. On the free plan it
stops for the day rather than billing. Keep new AI work there, and user-triggered
only: nothing that spends the allowance in the background.

The one exception is **sorting inbox tabs with Clef** (`ai/tabs.ts`, #153): it
runs on incoming mail, but only after the user switches it on, only for
messages that start a conversation (not replies, spam or senders they sorted
themselves), and it falls back to the header rules when the model fails or the
allowance runs out. Any new background AI needs the same: off by default, a
fallback, and a measured cost.

The Ask AI agent (`find.ts` + `service.ts`) gives the model tools, but **the
Worker runs them**: the model only ever sees clipped results, never D1. A new
tool means a definition in `FIND_TOOLS`, an entry in the service's `tools` table
that cleans its arguments, and a prompt line on when to use it. The model is
Qwen3 30B, small enough that it needs help, and every one of these was learned
on the real model:
- It must be forced to call a tool on the first turn, or it answers "I can't
  see your mail".
- Date ranges ("last month", "next week") must be spelled out in the prompt,
  because it can't do date sums.
- Empty searches are widened server-side, because it won't retry.

Unit tests use a scripted model; real behaviour can only be checked in
`wrangler dev`. The `AI` binding is always remote there, so that check spends
real (free) neurons.
