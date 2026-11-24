#!/bin/bash
# 동료 공유 묶음 만들기 → dist/gamebot.zip  (data/·key.txt·node_modules·스펙·개인 지침 제외)
set -e
cd "$(dirname "$0")/.."
cp ~/.claude/skills/gamebot/SKILL.md skill/SKILL.md   # 내가 쓰는 스킬이 원본
TMP="$(mktemp -d)"; mkdir "$TMP/gamebot"
rsync -a --exclude data --exclude node_modules --exclude key.txt --exclude dist --exclude .git \
  --exclude docs --exclude attic --exclude CLAUDE.md --exclude .DS_Store --exclude tools/publish.sh ./ "$TMP/gamebot/"
rm -f dist/gamebot.zip; mkdir -p dist
(cd "$TMP" && zip -qr - gamebot) > dist/gamebot.zip
rm -rf "$TMP"
unzip -l dist/gamebot.zip | tail -1
