#!/bin/bash
# 겜잘알봇 실행 (맥) — 더블클릭
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 가 필요해요: https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요."; read -r -p "엔터를 누르면 닫혀요"; exit 1
fi
[ -d node_modules ] || npm install --silent
(sleep 1.5 && open "http://localhost:${PORT:-9251}") &
node server.js
