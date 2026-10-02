#!/usr/bin/env bash
# Brings upstream (MHibriziF/zimail) into a copy of Zimail as a pull request. Runs from
# .github/workflows/sync-upstream.yml, which fetches this script from upstream each time, so
# copies get fixes to it without editing anything. Run from the repository root, on the
# branch to update.
#
# The pull request is upstream's main itself, so GitHub's own three-way merge keeps the
# copy's edits, brings in upstream's, and shows any conflict on the pull request.
#
# A copy made by the Deploy to Cloudflare button shares no history with upstream, and GitHub
# won't compare unrelated histories. So the first sync finds the upstream commit the copy
# was made from and records it with one "ours" merge: a commit that changes no files. From
# then on the copy and upstream are related, and every sync is an ordinary pull request.
#
# Without SYNC_PUBLISH=1 it prepares everything locally and pushes nothing.
set -euo pipefail

UPSTREAM_REPO="${UPSTREAM_REPO:-MHibriziF/zimail}"
BRANCH="${SYNC_BRANCH:-sync/upstream}"
UPSTREAM_REF="upstream/main"
# How far back to look for the commit a copy was made from.
SEARCH_DEPTH="${SYNC_SEARCH_DEPTH:-400}"

summary() {
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >>"$GITHUB_STEP_SUMMARY"; fi
	echo "$1"
}

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

# The upstream commit closest to this copy's first commit.
starting_point() {
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
	echo "$best"
}

# The pull request's branch: upstream's main with one commit putting `.github/workflows` back
# to this copy's own. GitHub never lets Actions create or change a workflow, and upstream's
# own workflows (its CI) need upstream's secrets, so a copy has no use for them anyway.
build_sync_branch() {
	local copy_head index tree
	copy_head="$(git rev-parse HEAD)"
	index="$(mktemp -d)/index"
	GIT_INDEX_FILE="$index" git read-tree "$UPSTREAM_REF"
	GIT_INDEX_FILE="$index" git rm -r -q --cached --ignore-unmatch .github/workflows
	if git cat-file -e "$copy_head:.github/workflows" 2>/dev/null; then
		GIT_INDEX_FILE="$index" git read-tree --prefix=.github/workflows/ "$copy_head:.github/workflows"
	fi
	tree="$(GIT_INDEX_FILE="$index" git write-tree)"
	rm -rf "$(dirname "$index")"
	if [ "$tree" = "$(git rev-parse "$UPSTREAM_REF^{tree}")" ]; then
		git branch --force "$BRANCH" "$UPSTREAM_REF"
	else
		git branch --force "$BRANCH" "$(git commit-tree "$tree" -p "$UPSTREAM_REF" -m "chore: keep this copy's own workflows")"
	fi
}

# Files GitHub will show as conflicting when the pull request is merged.
conflicting_files() {
	git merge-tree --write-tree --name-only --no-messages HEAD "$BRANCH" | tail -n +2 || true
}

publish() {
	local linked="$1" base="${BASE:-main}" conflicts="$2"
	# With an `upstream` remote, gh would otherwise target upstream, not this copy.
	if [ -n "${GITHUB_REPOSITORY:-}" ]; then export GH_REPO="$GITHUB_REPOSITORY"; fi
	if [ "$linked" = 1 ]; then git push --quiet origin "HEAD:$base"; fi
	git push --force --quiet origin "refs/heads/$BRANCH:refs/heads/$BRANCH"

	local body="Brings in the latest [Zimail](https://github.com/${UPSTREAM_REPO}). Your own changes, such as your Worker name, are kept. Merging redeploys as usual."
	if [ -n "$conflicts" ]; then
		body="${body}

Some of your changes overlap with this update, so GitHub will ask you to resolve them before merging (**Resolve conflicts** below):

$(printf '%s\n' "$conflicts" | sed 's/^/- `/; s/$/`/')"
	fi
	if [ "$(gh pr list --head "$BRANCH" --state open --json number --jq length)" != "0" ]; then
		summary "The open sync pull request now has the latest Zimail."
		return
	fi
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

if git merge-base --is-ancestor "$UPSTREAM_REF" HEAD; then
	summary "Already up to date with Zimail."
	exit 0
fi

linked=0
if ! git merge-base HEAD "$UPSTREAM_REF" >/dev/null; then
	start="$(starting_point)"
	if [ "$start" = "$(git rev-parse "$UPSTREAM_REF")" ]; then
		summary "Already up to date with Zimail."
		exit 0
	fi
	git merge --quiet -s ours --allow-unrelated-histories --no-edit \
		-m "chore: record which Zimail version this copy started from" "$start"
	linked=1
fi

build_sync_branch
conflicts="$(conflicting_files)"
if [ -n "$conflicts" ]; then
	summary "Ready, with overlapping changes to resolve on the pull request: $(echo "$conflicts" | tr '\n' ' ')"
else
	summary "Ready: the update merges cleanly."
fi
if [ "${SYNC_PUBLISH:-}" = "1" ]; then publish "$linked" "$conflicts"; fi
