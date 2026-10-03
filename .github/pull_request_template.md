## Summary

<!-- What changed and why, in a few lines. -->

Closes #

## Verification

- [ ] `bun test`
- [ ] `bun run check`
- [ ] Checked in `wrangler dev` (anything that runs in the Worker or touches D1)

## Checklist

- [ ] Title is a Conventional Commit: `type(scope): short message`
- [ ] Both themes (Classic and Zero), if it changes the UI
- [ ] Strings in all five `messages/*.json`
- [ ] New migration regenerated with `bun scripts/generate-migrations.mjs`

## Cost

<!--
Keep this section if the change runs on a schedule, changes how much or how often D1 is written,
adds schema or a new service, or uses a metered or free-tier quota. Otherwise delete it.
Runs per day × work per run, at today's data size and at 100×, plus the alternatives considered.
-->
