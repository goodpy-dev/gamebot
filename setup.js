#!/usr/bin/env node
// 겜잘알봇 설치·실행 한 번에 (맥·윈도우·리눅스)
//   node ~/gamebot/setup.js          → 스킬 설치 + 준비 + 서버 켜기 + 브라우저 열기
//   node ~/gamebot/setup.js --no-open → 브라우저는 열지 않음 (Claude 가 내장 브라우저로 열 때)
// 내 봇·기록(data/)은 건드리지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 9251;
const URL = `http://localhost:${PORT}`;
const noOpen = process.argv.includes('--no-open');
const say = (s) => console.log(s);

// 1. 스킬 설치 → Claude Code 어디서나 /gamebot
const skillDir = path.join(os.homedir(), '.claude', 'skills', 'gamebot');
fs.mkdirSync(skillDir, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'skill', 'SKILL.md'), path.join(skillDir, 'SKILL.md'));
say(`✓ 스킬 설치: ${path.join(skillDir, 'SKILL.md')}`);

// 2. 내 데이터 폴더 (있으면 그대로)
fs.mkdirSync(path.join(ROOT, 'data', 'bots'), { recursive: true });

// 3. 의존성
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--silent', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { say('✗ npm install 실패 — 인터넷 연결을 확인하고 다시 실행해 주세요.'); process.exit(1); }
}
say('✓ 준비 완료');

// 4. 서버 (이미 겜잘알봇이 떠 있으면 그대로 씀)
function status() {
  return new Promise((res) => {
    const req = http.get(`${URL}/api/status`, { timeout: 1500 }, (r) => {
      let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => { try { JSON.parse(s); res('gamebot'); } catch { res('other'); } });
    });
    req.on('error', () => res('none'));
    req.on('timeout', () => { req.destroy(); res('none'); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let st = await status();
  if (st === 'other') { say(`✗ ${PORT} 포트를 다른 프로그램이 쓰고 있어요. PORT=9351 node setup.js 처럼 다른 포트로 실행해 주세요.`); process.exit(1); }
  if (st === 'none') {
    const log = fs.openSync(path.join(ROOT, 'data', 'server.log'), 'a');
    spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: { ...process.env, PORT: String(PORT) }, windowsHide: true }).unref();
    for (let i = 0; i < 20 && st !== 'gamebot'; i++) { await sleep(500); st = await status(); }
    if (st !== 'gamebot') { say(`✗ 서버가 안 켜졌어요. 기록: ${path.join(ROOT, 'data', 'server.log')}`); process.exit(1); }
  }
  say(`✓ 겜잘알봇 서버: ${URL}`);

  // 5. 브라우저 — 봇이 없으면 첫 화면이 취향 테스트(봇 만들기)
  if (!noOpen) {
    const cmd = process.platform === 'darwin' ? ['open', [URL]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL]] : ['xdg-open', [URL]];
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* 못 열면 주소만 안내 */ }
  }
  const hasBot = fs.readdirSync(path.join(ROOT, 'data', 'bots')).some((f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bots', f), 'utf8')).mine; } catch { return false; } });
  say(hasBot
    ? '\n내 봇이 이미 있어요. Claude Code 에서  /gamebot <고민>  으로 물어보세요.'
    : `\n${URL} 에서 취향 테스트 → 결과지 → "봇" 탭 "내 봇 저장" 까지 하면 내 봇이 생겨요.\n그다음 Claude Code 에서  /gamebot <고민>  으로 물어보세요. (채팅으로 만들려면  /gamebot 봇 만들기)`);
})();
