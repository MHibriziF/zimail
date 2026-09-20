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

**CRLF.** The working tree is CRLF. Any script that rewrites `messages/*.json`
or a source file must detect and restore the original line endings, or the diff
becomes the whole file. `generate-migrations.mjs` normalizes to LF on purpose —
CI checks out LF and would otherwise mismatch.

**Heredocs in Bash are unreliable here.** Multi-line content and regexes get
mangled. Write the script with the Write tool and run it with node, or use Edit.

**`gh` defaults to the upstream remote.** Always pass `--repo MHibriziF/zimail`.

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
