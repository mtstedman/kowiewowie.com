#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
    cat <<'EOF'
Usage: ./deploy/deploy.sh [--allow-unpushed]

Deploy the exact commit checked out on main. By default, deployment is allowed
only when the worktree is clean and HEAD matches origin/main. The versioned
post-commit hook uses --allow-unpushed after making the same branch/cleanliness
checks; manual deployments should use the default pushed-revision guard.
EOF
}

allow_unpushed=false
while (($# > 0)); do
    case "$1" in
        --allow-unpushed)
            allow_unpushed=true
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown argument: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel)"
readonly TARGET_BRANCH="main"
readonly REMOTE="origin"
readonly CURRENT_BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"
readonly REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
readonly WEB_ROOT="/var/www/wowiekowie.com"
readonly API_ENV_FILE="/etc/wowiekowie.com/api.env"
readonly LOCK_FILE="/tmp/wowiekowie.com-deploy.lock"

if [[ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
    printf 'Refusing to deploy branch %s; production deployments must come from %s.\n' \
        "${CURRENT_BRANCH:-detached HEAD}" "$TARGET_BRANCH" >&2
    exit 1
fi

if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ]]; then
    printf 'Refusing to deploy a dirty worktree. Commit or remove all changes first.\n' >&2
    exit 1
fi

if [[ "$allow_unpushed" == false ]]; then
    git -C "$REPO_ROOT" fetch --quiet "$REMOTE" "$TARGET_BRANCH"
    readonly REMOTE_REVISION="$(git -C "$REPO_ROOT" rev-parse "refs/remotes/$REMOTE/$TARGET_BRANCH")"
    if [[ "$REVISION" != "$REMOTE_REVISION" ]]; then
        printf 'Refusing to deploy %s: it does not match %s/%s at %s. Push main first.\n' \
            "${REVISION:0:12}" "$REMOTE" "$TARGET_BRANCH" "${REMOTE_REVISION:0:12}" >&2
        exit 1
    fi
fi

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

git -C "$REPO_ROOT" archive "$REVISION" htdocs api includes database | tar -x -C "$release_dir"

while IFS= read -r -d '' php_file; do
    php -l "$php_file" >/dev/null
done < <(find "$release_dir/htdocs" "$release_dir/api" "$release_dir/includes" "$release_dir/database" -type f -name '*.php' -print0)

if ! sudo -n test -r "$API_ENV_FILE"; then
    printf 'Missing readable API environment file: %s\n' "$API_ENV_FILE" >&2
    exit 1
fi

sudo -n install -d -o root -g www-data -m 0755 \
    "$WEB_ROOT/htdocs" "$WEB_ROOT/api" "$WEB_ROOT/includes" "$WEB_ROOT/database"

sudo -n rsync --archive --delete --delay-updates \
    --chown=root:www-data --chmod=D755,F644 \
    "$release_dir/includes/" "$WEB_ROOT/includes/"

sudo -n rsync --archive --delete --delay-updates \
    --chown=root:www-data --chmod=D755,F644 \
    "$release_dir/database/" "$WEB_ROOT/database/"

sudo -n env WOWIE_ENV_FILE="$API_ENV_FILE" \
    php "$release_dir/database/migrate.php"

sudo -n rsync --archive --delete --delay-updates \
    --chown=root:www-data --chmod=D755,F644 \
    "$release_dir/htdocs/" "$WEB_ROOT/htdocs/"

sudo -n rsync --archive --delete --delay-updates \
    --chown=root:www-data --chmod=D755,F644 \
    "$release_dir/api/" "$WEB_ROOT/api/"

curl --noproxy '*' --fail --silent --show-error \
    --resolve wowiekowie.com:443:127.0.0.1 \
    https://wowiekowie.com/ >/dev/null

curl --noproxy '*' --fail --silent --show-error \
    --resolve wowiekowie.com:443:127.0.0.1 \
    https://wowiekowie.com/api/games >/dev/null

curl --noproxy '*' --fail --silent --show-error \
    --resolve api.wowiekowie.com:443:127.0.0.1 \
    https://api.wowiekowie.com/health >/dev/null

printf 'Deployment complete: %s\n' "${REVISION:0:12}"
