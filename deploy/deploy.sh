#!/usr/bin/env bash

set -Eeuo pipefail

readonly REPO_ROOT="$(git rev-parse --show-toplevel)"
readonly REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
readonly WEB_ROOT="/var/www/wowiekowie.com"
readonly LOCK_FILE="/tmp/wowiekowie.com-deploy.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    printf 'A wowiekowie.com deployment is already running.\n' >&2
    exit 1
fi

release_dir="$(mktemp -d /tmp/wowiekowie.com-release.XXXXXX)"
cleanup() {
    rm -rf -- "$release_dir"
}
trap cleanup EXIT

printf 'Deploying wowiekowie.com at %s\n' "${REVISION:0:12}"

git -C "$REPO_ROOT" archive "$REVISION" htdocs api | tar -x -C "$release_dir"

while IFS= read -r -d '' php_file; do
    php -l "$php_file" >/dev/null
done < <(find "$release_dir/htdocs" "$release_dir/api" -type f -name '*.php' -print0)

sudo -n install -d -o root -g www-data -m 0755 \
    "$WEB_ROOT/htdocs" "$WEB_ROOT/api"

sudo -n rsync --archive --delete --delay-updates \
    --chown=root:www-data --chmod=D755,F644 \
    "$release_dir/htdocs/" "$WEB_ROOT/htdocs/"

sudo -n rsync --archive --delete --delay-updates \
    --chown=root:www-data --chmod=D755,F644 \
    "$release_dir/api/" "$WEB_ROOT/api/"

curl --noproxy '*' --fail --silent --show-error \
    -H 'Host: wowiekowie.com' http://127.0.0.1/ >/dev/null

curl --noproxy '*' --fail --silent --show-error \
    --resolve api.wowiekowie.com:443:127.0.0.1 \
    https://api.wowiekowie.com/health >/dev/null

printf 'Deployment complete: %s\n' "${REVISION:0:12}"
