#!/usr/bin/env bash
# Merges upstream (MHibriziF/zimail) into a `sync/upstream` branch of this repository, for
# .github/workflows/sync-upstream.yml to open as a pull request. Run from the repo root with
# the `upstream` remote already fetched.
#
# A copy made by the Deploy to Cloudflare button is a fresh repository with no history in
# common with upstream, so git would see every changed file as a conflict, wrangler.jsonc
# (with this deployment's own database IDs) included. The first sync therefore finds the
# upstream commit the copy was made from and grafts the copy's first commit onto it. From
# there it is an ordinary three-way merge: upstream's changes come in, and this repository's
# own edits, such as its IDs and Worker name, stay. The merge commit then records the real
# relationship, so later syncs need no graft.
#
# Writes `changed=true|false` to $GITHUB_OUTPUT when set.
set -euo pipefail

BRANCH="${SYNC_BRANCH:-sync/upstream}"
UPSTREAM_REF="${UPSTREAM_REF:-upstream/main}"
# How far back to look for the commit a copy was made from.
SEARCH_DEPTH="${SYNC_SEARCH_DEPTH:-400}"

output() {
	if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >>"$GITHUB_OUTPUT"; fi
}

if git merge-base --is-ancestor "$UPSTREAM_REF" HEAD; then
	echo "Already up to date with $UPSTREAM_REF."
	output "changed=false"
	exit 0
fi

# Lines that differ between two trees; binary files count as nothing.
distance() {
	git diff --numstat "$1" "$2" | awk '$1 != "-" { total += $1 + $2 } END { print total + 0 }'
}

if ! git merge-base HEAD "$UPSTREAM_REF" >/dev/null; then
	root="$(git rev-list --max-parents=0 HEAD | tail -n 1)"
	best=""
	best_distance=""
	for commit in $(git rev-list --max-count="$SEARCH_DEPTH" "$UPSTREAM_REF"); do
		current="$(distance "$commit" "$root")"
		if [ -z "$best_distance" ] || [ "$current" -lt "$best_distance" ]; then
			best="$commit"
			best_distance="$current"
		fi
		if [ "$current" -eq 0 ]; then break; fi
	done
	echo "First sync: this repository starts from upstream $(git log -1 --format='%h %s' "$best") ($best_distance lines differ)."
	git replace -f --graft "$root" "$best"
fi

git checkout -B "$BRANCH"
before="$(git rev-parse HEAD)"
merged=true
if ! git merge --no-edit -m "chore: sync from upstream" "$UPSTREAM_REF"; then
	echo "Upstream changed the same lines as this repository:" >&2
	git diff --name-only --diff-filter=U >&2
	git merge --abort
	merged=false
fi
# The graft only steered this merge; the merge commit itself has the real parents.
if [ -n "${root:-}" ]; then git replace -d "$root" >/dev/null; fi
if [ "$merged" = false ]; then exit 1; fi
# A copy made from the newest upstream has nothing to take in, even on its first sync.
if [ "$(git rev-parse HEAD)" = "$before" ]; then
	echo "Already up to date with $UPSTREAM_REF."
	output "changed=false"
	exit 0
fi
output "changed=true"
