#!/usr/bin/env bash
# Brings upstream (MHibriziF/zimail) into a copy of Zimail as a pull request. Runs from
# .github/workflows/sync-upstream.yml, which fetches this script from upstream each time, so
# copies get fixes to it without editing anything. Run from the repository root.
#
# A copy made by the Deploy to Cloudflare button is a fresh repository with no history in
# common with upstream, so git would see every changed file as a conflict, wrangler.jsonc
# included. The first sync therefore finds the upstream commit the copy was made from and
# grafts the copy's first commit onto it. From there it is an ordinary three-way merge:
# upstream's changes come in, and the copy's own edits, such as its Worker name, stay. The
# merge commit records the real relationship, so later syncs need no graft.
#
# Without SYNC_PUBLISH=1 it only merges into the local `sync/upstream` branch.
set -euo pipefail

UPSTREAM_REPO="${UPSTREAM_REPO:-MHibriziF/zimail}"
BRANCH="${SYNC_BRANCH:-sync/upstream}"
UPSTREAM_REF="upstream/main"
# How far back to look for the commit a copy was made from.
SEARCH_DEPTH="${SYNC_SEARCH_DEPTH:-400}"

fetch_upstream() {
	if ! git remote get-url upstream >/dev/null 2>&1; then
		git remote add upstream "https://github.com/${UPSTREAM_REPO}.git"
	fi
	git fetch --quiet upstream main
}

# Lines that differ between two trees; binary files count as nothing.
distance() {
	git diff --numstat "$1" "$2" | awk '$1 != "-" { total += $1 + $2 } END { print total + 0 }'
}

# Prints the copy's first commit after grafting it onto the closest upstream commit.
graft_onto_upstream() {
	local root best="" best_distance="" commit current
	root="$(git rev-list --max-parents=0 HEAD | tail -n 1)"
	for commit in $(git rev-list --max-count="$SEARCH_DEPTH" "$UPSTREAM_REF"); do
		current="$(distance "$commit" "$root")"
		if [ -z "$best_distance" ] || [ "$current" -lt "$best_distance" ]; then
			best="$commit"
			best_distance="$current"
		fi
		if [ "$current" -eq 0 ]; then break; fi
	done
	echo "First sync: this repository starts from upstream $(git log -1 --format='%h %s' "$best") ($best_distance lines differ)." >&2
	git replace -f --graft "$root" "$best"
	echo "$root"
}

# Merges upstream into $BRANCH. Exit status: 0 merged something, 3 nothing new, 1 conflict.
merge_upstream() {
	if git merge-base --is-ancestor "$UPSTREAM_REF" HEAD; then return 3; fi
	local root="" before status=0
	if ! git merge-base HEAD "$UPSTREAM_REF" >/dev/null; then root="$(graft_onto_upstream)"; fi
	git checkout -B "$BRANCH"
	before="$(git rev-parse HEAD)"
	if ! git merge --no-edit -m "chore: sync from upstream" "$UPSTREAM_REF"; then
		echo "Upstream changed the same lines as this repository:" >&2
		git diff --name-only --diff-filter=U >&2
		git merge --abort
		status=1
	fi
	# The graft only steered this merge; the merge commit itself has the real parents.
	if [ -n "$root" ]; then git replace -d "$root" >/dev/null; fi
	if [ "$status" -eq 0 ] && [ "$(git rev-parse HEAD)" = "$before" ]; then status=3; fi
	return "$status"
}

summary() {
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >>"$GITHUB_STEP_SUMMARY"; fi
	echo "$1"
}

publish() {
	local base="${BASE:-main}"
	git push --force --quiet origin "$BRANCH"
	if [ "$(gh pr list --head "$BRANCH" --state open --json number --jq length)" != "0" ]; then
		summary "The open sync pull request now has the latest Zimail."
		return
	fi
	local body="Brings in the latest [Zimail](https://github.com/${UPSTREAM_REPO}). Your own changes, such as your Worker name, are kept. Merging redeploys as usual."
	if ! gh pr create --head "$BRANCH" --base "$base" --title "Sync from ${UPSTREAM_REPO}" --body "$body"; then
		# New repositories don't let Actions open pull requests until it's allowed once.
		summary "The \`$BRANCH\` branch is ready, but this repository doesn't let Actions open pull requests."
		summary "Open one: https://github.com/${GITHUB_REPOSITORY:-}/compare/${base}...${BRANCH}"
		summary "Or allow it once: Settings → Actions → General → \"Allow GitHub Actions to create and approve pull requests\"."
	fi
}

if [ "${SYNC_PUBLISH:-}" = "1" ]; then
	git config user.name 'github-actions[bot]'
	git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
fi
fetch_upstream
status=0
merge_upstream || status=$?
case "$status" in
	3)
		summary "Already up to date with Zimail."
		;;
	0)
		if [ "${SYNC_PUBLISH:-}" = "1" ]; then publish; fi
		;;
	*)
		exit 1
		;;
esac
