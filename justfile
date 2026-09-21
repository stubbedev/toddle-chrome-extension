# toddle-companion dev / release tasks.
# Version lives in extension/package.json and extension/public/manifest.json
# (Chrome shows the manifest one) — `just release` keeps both in sync.

default:
    @just --list

# typecheck + build (the gate every release runs).
check:
    cd extension && npm run build

# Build dist/ and the Chrome-installable zip of it.
pack:
    #!/usr/bin/env bash
    set -euo pipefail
    cd extension
    npm run build
    v="$(node -p "require('./package.json').version")"
    rm -f "toddle-companion-$v.zip"
    (cd dist && zip -qr "../toddle-companion-$v.zip" .)
    echo "packed: extension/toddle-companion-$v.zip"

# Show the current and next major/minor/patch versions.
release-preview:
    #!/usr/bin/env bash
    set -euo pipefail
    v="$(grep -oP '"version":\s*"\K[^"]+' extension/package.json)"
    IFS=. read -r maj min pat <<<"$v"
    echo "current: $v"
    echo "patch:   $maj.$min.$((pat + 1))"
    echo "minor:   $maj.$((min + 1)).0"
    echo "major:   $((maj + 1)).0.0"

release-patch: (release "patch")
release-minor: (release "minor")
release-major: (release "major")

# Bump the version (package.json + manifest.json), build the installable zip,
# commit, tag, push, and publish a GitHub release with the zip attached —
# drag-and-drop installable from any machine with a browser.
release level:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "working tree is dirty — commit or stash first" >&2
        exit 1
    fi
    v="$(grep -oP '"version":\s*"\K[^"]+' extension/package.json)"
    IFS=. read -r maj min pat <<<"$v"
    case "{{ level }}" in
        patch) new="$maj.$min.$((pat + 1))" ;;
        minor) new="$maj.$((min + 1)).0" ;;
        major) new="$((maj + 1)).0.0" ;;
        *) echo "unknown level: {{ level }}" >&2; exit 1 ;;
    esac
    echo "releasing v$v -> v$new"
    sed -i "s#\"version\": \"$v\"#\"version\": \"$new\"#" extension/package.json
    sed -i "s#\"version\": \"$v\"#\"version\": \"$new\"#" extension/public/manifest.json
    just check
    just pack
    git add extension/package.json extension/public/manifest.json
    git commit -m "release: v$new"
    git tag "v$new"
    git push origin HEAD
    git push origin "v$new"
    gh release create "v$new" "extension/toddle-companion-$new.zip" \
        --title "v$new" --notes "Chrome: chrome://extensions -> drag the zip onto the page (or download and drop)."
    echo "released v$new"
