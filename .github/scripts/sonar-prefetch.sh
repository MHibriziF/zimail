#!/usr/bin/env bash
# Puts the SonarScanner's big downloads — the analysis engine and the plugins
# this repo's languages need — into its cache before it runs. The JRE isn't
# one of them: sonar.scanner.skipJreProvisioning uses the one the CLI ships.
#
# Our SonarQube sits behind a proxy that intermittently stalls or resets large
# downloads, and the scanner gives up on the first one; a scan then hangs for
# half an hour or fails with "stream was reset". This retries each file, gives
# up on a stalled attempt after 20 slow seconds rather than waiting it out, and
# checks every file against the server's checksum. A file already cached with
# the right checksum is left alone, so a warm cache costs a few metadata calls.
#
# Never fails the job: whatever is still missing, the scanner fetches itself.
#
# Env: SONAR_HOST_URL, SONAR_TOKEN. Optional: SONAR_CACHE (default ~/.sonar/cache).
set -uo pipefail

cache="${SONAR_CACHE:-$HOME/.sonar/cache}"
host="${SONAR_HOST_URL%/}"
plugins="javascript text iac web xml"

api() {
	curl -sf --retry 3 --max-time 30 -u "$SONAR_TOKEN:" -H 'Accept: application/json' "$host$1"
}

digest() {
	case "$1" in
	sha256) sha256sum "$2" | cut -d' ' -f1 ;;
	md5) md5sum "$2" | cut -d' ' -f1 ;;
	esac
}

# fetch <url path> <hash> <hash kind> <filename>
fetch() {
	local url=$1 hash=$2 kind=$3 file=$4
	local target="$cache/$hash/$file"
	if [ -f "$target" ] && [ "$(digest "$kind" "$target")" = "$hash" ]; then
		echo "cached: $file"
		return 0
	fi
	mkdir -p "$cache/$hash"
	local partial="$target.part"
	for attempt in 1 2 3 4 5 6; do
		if curl -sSf --max-time 300 --speed-limit 50000 --speed-time 20 \
			-u "$SONAR_TOKEN:" -H 'Accept: application/octet-stream' -o "$partial" "$host$url"; then
			local got
			got=$(digest "$kind" "$partial")
			if [ "$got" = "$hash" ]; then
				mv "$partial" "$target"
				echo "fetched: $file (attempt $attempt)"
				return 0
			fi
			echo "checksum mismatch on $file (attempt $attempt): $got"
		else
			echo "download failed on $file (attempt $attempt): $url"
		fi
		rm -f "$partial"
		sleep $((attempt * 3))
	done
	echo "gave up: $file — the scanner will try it itself"
}

engine=$(api /api/v2/analysis/engine) &&
	fetch /api/v2/analysis/engine "$(jq -r .sha256 <<<"$engine")" sha256 "$(jq -r .filename <<<"$engine")"

installed=$(api /api/plugins/installed) || installed='{"plugins":[]}'
for key in $plugins; do
	plugin=$(jq -c --arg key "$key" '.plugins[] | select(.key == $key)' <<<"$installed")
	[ -n "$plugin" ] || continue
	fetch "/api/plugins/download?plugin=$key" "$(jq -r .hash <<<"$plugin")" md5 "$(jq -r .filename <<<"$plugin")"
done
exit 0
