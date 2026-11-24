// 겜잘알봇 로컬 서버 — 화면 파일 + 취향 분석 API. 스펙: docs/specs/gamebot.md
// 실행: node dev/gamebot/server.js  →  http://localhost:9251  (무료 규칙 분석: /?mock=1)
// AI 키(ANTHROPIC_API_KEY)는 이 서버에서만 읽는다. 화면·로그·파일에 키 값을 남기지 않는다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { GAMES, AXES, ART_STYLES } = require('./games.js');
const bot = require('./ask.js');
const persona = require('./persona.js');
const media = require('./media.js');

const PORT = Number(process.env.PORT) || 9251;
// Node 18 미만은 fetch 가 없어 Steam 캡처·AI 가 안 된다
if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error(`Node.js ${process.versions.node} 는 너무 오래됐어요. https://nodejs.org 에서 18 이상(LTS)을 설치해 주세요.`);
  process.exit(1);
}
// 예상 못한 오류가 나도 서버는 계속 돈다 — 기록은 data/error.log
const logError = (where, e) => {
  const line = `[${new Date().toISOString()}] ${where}: ${e && e.stack ? e.stack : e}\n`;
  console.error(`[gamebot] 오류(${where}): ${e && e.message ? e.message : e}`);
  try { fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true }); fs.appendFileSync(path.join(__dirname, 'data', 'error.log'), line); } catch { /* 기록 실패 무시 */ }
};
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));
// 키는 환경변수 ANTHROPIC_API_KEY, 없으면 이 폴더의 key.txt 한 줄 (값은 어디에도 출력하지 않음)
if (!process.env.ANTHROPIC_API_KEY) {
  try { const k = fs.readFileSync(path.join(__dirname, 'key.txt'), 'utf8').trim(); if (k && !k.startsWith('#')) process.env.ANTHROPIC_API_KEY = k; } catch { /* 없음 */ }
}
// 만드는 사람 원칙·게임 요약은 선택 (없으면 플레이어 취향만으로 분석)
const readOpt = (f) => { try { return fs.readFileSync(path.join(__dirname, f), 'utf8').trim(); } catch { return ''; } };
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const STATIC = new Set(['index.html', 'app.js', 'ask-ui.js', 'profile-ui.js', 'style.css', 'games.js']);

const safeUser = (u) => String(u || 'me').replace(/[^a-zA-Z0-9가-힣_-]/g, '').slice(0, 32) || 'me';
const profilePath = (u) => path.join(DATA, `profile-${safeUser(u)}.json`);
const byName = new Map(GAMES.map((g) => [g.name, g]));

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
  });
}

// ── 아트 조사: 화풍별 점수 (한 판 k장 중 r등 = 1 - r/(k-1), 평균) — 게임성 점수와 섞지 않는다 ──
function artScores(art) {
  const sum = {}, cnt = {};
  for (const r of art) {
    const k = r.order.length;
    r.order.forEach((x, i) => {
      const s = k === 1 ? 0.75 : 1 - i / (k - 1);
      sum[x.style] = (sum[x.style] || 0) + s; cnt[x.style] = (cnt[x.style] || 0) + 1;
    });
  }
  return ART_STYLES.filter((st) => cnt[st]).map((st) => ({ style: st, score: Math.round((sum[st] / cnt[st]) * 100), n: cnt[st] }))
    .sort((a, b) => b.score - a.score);
}

function mockArt(art) {
  const sc = artScores(art);
  if (!sc.length) return { summary: '아트 조사를 건너뛰었어요', styles: [] };
  const top = sc.filter((s) => s.score >= 60).map((s) => s.style);
  const low = sc.filter((s) => s.score <= 30).map((s) => s.style);
  return {
    summary: `${(top.length ? top : [sc[0].style]).join('·')} 쪽 그림에 끌림` + (low.length ? `, ${low.join('·')}은(는) 덜 끌림` : ''),
    styles: sc.map((s) => ({ style: s.style, score: s.score, note: `${s.n}장 비교` })),
  };
}

// ── 규칙 분석 (무료·시험용): 순위 가중치 1/√순위 로 태그를 합친다 ──
function mockAnalyze({ likes, dislikes, art }) {
  const known = likes.map((n, i) => ({ g: byName.get(n), w: 1 / Math.sqrt(i + 1), n })).filter((x) => x.g);
  const bad = dislikes.map((n) => byName.get(n)).filter(Boolean);
  const sumW = known.reduce((a, x) => a + x.w, 0) || 1;
  const vec = AXES.map((_, k) => {
    let v = known.reduce((a, x) => a + x.w * x.g.ax[k], 0) / sumW;
    if (bad.length) v -= 0.35 * (bad.reduce((a, g) => a + g.ax[k], 0) / bad.length);
    return Math.max(-2, Math.min(2, v));
  });
  const kwScore = new Map();
  known.forEach(({ g, w }) => [...g.kw, ...g.genres].forEach((t) => kwScore.set(t, (kwScore.get(t) || 0) + w)));
  const keywords = [...kwScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  const axes = AXES.map((a, k) => ({
    left: a.left, right: a.right, score: Math.round(((vec[k] + 2) / 4) * 100),
    note: Math.abs(vec[k]) < 0.5 ? '어느 쪽도 치우치지 않음' : `${vec[k] > 0 ? a.right : a.left} 쪽으로 기움`,
  }));
  const strong = axes.map((a, k) => ({ a, d: Math.abs(vec[k]), k })).sort((x, y) => y.d - x.d).slice(0, 2);
  const lean = (x) => (vec[x.k] > 0 ? x.a.right : x.a.left);
  const picked = new Set([...likes, ...dislikes]);
  const far = GAMES.filter((g) => !picked.has(g.name))
    .map((g) => ({ g, d: g.ax.reduce((a, v, k) => a + (v - vec[k]) ** 2, 0) }))
    .sort((a, b) => b.d - a.d);
  const outside = [];
  const usedGenre = new Set();
  for (const { g } of far) {
    if (outside.length >= 3) break;
    if (usedGenre.has(g.genres[0])) continue;
    usedGenre.add(g.genres[0]);
    const k = g.ax.map((v, i) => Math.abs(v - vec[i])).reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0);
    outside.push({
      direction: `${g.genres[0]} — ${g.kw[0]}`,
      games: [g.name],
      why: `평소 취향과 '${AXES[k].left}↔${AXES[k].right}' 축이 반대편이라, 안 해 본 감각(${g.kw.join(', ')})을 볼 수 있어요.`,
    });
  }
  return {
    summary: `${lean(strong[0])}·${lean(strong[1])} 쪽을 좋아하는 플레이어`,
    keywords,
    axes,
    description: `판별 순위를 모은 상위 3개(${likes.slice(0, 3).join(', ')})에 무게를 두고 계산했어요. 자주 겹친 특징은 ${keywords.slice(0, 4).join(', ')}입니다.` + (likes.length > known.length ? ` 목록 밖에서 직접 넣은 게임(${likes.filter((n) => !byName.has(n)).join(', ')})은 규칙 분석에서 빠졌어요(AI 분석에서는 반영).` : ''),
    maker: readOpt('data/maker-profile.md') ? '규칙 분석에서는 만드는 사람 원칙(maker-profile.md)을 섞지 않아요. AI 분석에서 같이 봅니다.' : '',
    outside,
    art: mockArt(art),
  };
}

// ── AI 분석 ──
const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'keywords', 'axes', 'description', 'maker', 'outside', 'art'],
  properties: {
    art: {
      type: 'object', additionalProperties: false, required: ['summary', 'styles'],
      properties: {
        summary: { type: 'string' },
        styles: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['style', 'score', 'note'],
            properties: { style: { type: 'string' }, score: { type: 'integer' }, note: { type: 'string' } },
          },
        },
      },
    },
    summary: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    axes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['left', 'right', 'score', 'note'],
        properties: { left: { type: 'string' }, right: { type: 'string' }, score: { type: 'integer' }, note: { type: 'string' } },
      },
    },
    description: { type: 'string' },
    maker: { type: 'string' },
    outside: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['direction', 'games', 'why'],
        properties: { direction: { type: 'string' }, games: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } },
      },
    },
  },
};

async function aiAnalyze({ likes, dislikes, rounds, art }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const maker = readOpt('data/maker-profile.md');
  const describe = (n) => {
    const g = byName.get(n);
    return g ? `${n} [${g.genres.join('/')}; ${g.kw.join(', ')}]` : `${n} [목록 밖 — 직접 입력]`;
  };
  const prompt = [
    '아래는 한 게임 개발자가 온보딩에서 한 판에 게임 4개씩 순위를 매긴 결과다.',
    '',
    '판별 순위(왼쪽이 더 좋아함, "모름"은 안 해 본 게임):',
    ...rounds.map((r, i) => `${i + 1}판: ${r.order.join(' > ') || '(다 모름)'}${r.unknown.length ? ` / 모름: ${r.unknown.join(', ')}` : ''}`),
    '',
    '순위를 모아 정리한 좋아하는 게임(순서대로, 맨 앞의 직접 입력은 최애로 더한 것):',
    ...likes.map((n, i) => `${i + 1}. ${describe(n)}`),
    '',
    '별로라고 표시한 게임:',
    ...(dislikes.length ? dislikes.map((n) => `- ${describe(n)}`) : ['- (없음)']),
    '',
    '아트 조사(게임 이름을 가린 인게임 스크린샷 4장을 그림만 보고 순위 매김, 게임성 조사와 별개):',
    ...(art.length ? art.map((r, i) => `${i + 1}판: ${r.order.map((x) => `${x.style}(${x.game})`).join(' > ')}`) : ['(건너뜀)']),
    `화풍별 점수(0~100): ${artScores(art).map((s) => `${s.style} ${s.score}`).join(', ') || '없음'}`,
    '',
    ...(maker ? ['이 사람이 지금 만들고 있는 게임과 개발 원칙:', maker, ''] : []),
    '취향 프로필을 만들어라. 규칙:',
    '- 모든 글은 한국어, 짧고 구체적으로. 게임 이름과 그 게임의 실제 시스템을 근거로 든다.',
    `- axes 는 정확히 다음 5개를 이 순서로: ${AXES.map((a) => `${a.left}↔${a.right}`).join(', ')}. score 는 0(왼쪽)~100(오른쪽). note 는 근거 한 줄.`,
    '- keywords 는 6~8개. 장르명보다 "좋아하는 감각·시스템"(예: 조합이 터지는 순간, 숫자 폭발, 손그림 도트).',
    '- summary 는 한 줄. description 은 3~4문장.',
    maker ? '- maker 는 "플레이어로서의 취향"과 "만드는 사람의 원칙"이 겹치거나 부딪히는 지점 2~3문장.' : '- maker 는 빈 문자열 "" (이 사람은 게임 개발 정보를 주지 않았다).',
    `- art 는 아트 조사만 보고 쓴다(게임성 순위와 섞지 말 것). styles 는 조사에 나온 화풍만, 점수 높은 순. score 는 위 화풍별 점수를 기준으로 하되 같은 화풍 안에서 끌린 그림/안 끌린 그림의 차이가 보이면 note 에 적는다. summary 는 한 줄.`,
    '- outside 는 정확히 3개: 이 사람이 평소 안 고를 것 같지만 볼 만한(만드는 사람이면 창작에 도움이 될) 방향. 각각 실제 게임 1~2개와 왜 볼 만한지.',
  ].join('\n');

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PROFILE_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI 가 분석을 거절했어요');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const usage = response.usage || {};
  console.log(`[gamebot] AI 분석 완료 — 입력 ${usage.input_tokens} / 출력 ${usage.output_tokens} 토큰`);
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/profile') {
      const p = profilePath(url.searchParams.get('user'));
      return fs.existsSync(p) ? send(res, 200, fs.readFileSync(p, 'utf8')) : send(res, 404, { error: 'none' });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/profile') {
      const p = profilePath(url.searchParams.get('user'));
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/shot') {
      // 아트 조사용 인게임 스크린샷 — Steam 공개 상점 정보에서 한 장 고른다(저장하지 않고 주소만 돌려줌)
      const name = url.searchParams.get('name') || '';
      if (!GAMES.some((g) => g.name === name)) return send(res, 400, { error: 'unknown game' });
      const m = await media.getMedia(name);
      if (!m.shots.length) return send(res, 404, { error: 'no screenshots' });
      // Steam 첫 장은 로고·타이틀이 많아 2~6번째에서, 앱스토어는 1~5번째에서 고른다
      const from = m.source === 'steam' && m.shots.length > 1 ? 1 : 0;
      const pick = m.shots[from + Math.floor(Math.random() * Math.max(1, Math.min(5, m.shots.length - from)))] || m.shots[0];
      return send(res, 200, { url: pick });
    }
    if (req.method === 'GET' && url.pathname === '/api/media') {
      const m = await media.getMedia(url.searchParams.get('name') || '');
      return send(res, 200, { cover: m.cover, icon: !!m.icon, shots: m.shots.length, source: m.source });
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      const body = await readBody(req);
      const question = String(body.question || '').trim().slice(0, 1000);
      if (!question) return send(res, 400, { error: '질문을 적어 주세요' });
      const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((h) => ({
        q: String(h.q || '').slice(0, 300), games: (h.games || []).map(String).slice(0, 12), pick: h.pick ? String(h.pick).slice(0, 40) : '',
      }));
      const more = ['similar', 'opposite', 'wild'].includes(body.more) ? body.more : '';
      const image = typeof body.image === 'string' && body.image.length < 7e6 ? body.image : '';
      return send(res, 200, await bot.ask({ user: body.user, question, image, history, more, mock: !!body.mock }));
    }
    if (req.method === 'POST' && url.pathname === '/api/board') {
      // 클로드 스킬(/gamebot)이 만든 답을 받아 Steam 캡처를 붙여 보드로 저장
      const body = await readBody(req);
      if (!body.question || !body.answer) return send(res, 400, { error: 'question·answer 가 필요해요' });
      const b = await bot.buildBoard({ user: body.user, question: body.question, answer: body.answer, usage: { input: 0, output: 0, searches: 0 }, via: 'claude-code', pick: !!body.pick && !!process.env.ANTHROPIC_API_KEY });
      return send(res, 200, { id: b.id, url: `http://localhost:${PORT}/?board=${b.id}`, cards: [b.current, ...b.refs].filter(Boolean).map((r) => ({ game: r.game, source: r.source, shots: r.shots.length })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/board') {
      const b = bot.loadBoard(url.searchParams.get('id') || '');
      return b ? send(res, 200, b) : send(res, 404, { error: 'none' });
    }
    if (req.method === 'POST' && url.pathname === '/api/feedback') {
      const body = await readBody(req);
      return send(res, 200, bot.saveFeedback(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/remix') {
      // 이미 있는 프로필의 결과지 문구만 다시 쓰기
      const body = await readBody(req);
      const p = profilePath(body.user);
      if (!fs.existsSync(p)) return send(res, 404, { error: 'none' });
      const prof = JSON.parse(fs.readFileSync(p, 'utf8'));
      const useAI = !body.mock && !!process.env.ANTHROPIC_API_KEY;
      prof.persona = useAI ? await persona.aiPersona(prof) : persona.mockPersona(prof);
      fs.writeFileSync(p, JSON.stringify(prof, null, 2));
      return send(res, 200, prof);
    }
    if (url.pathname === '/api/bots') {
      if (req.method === 'GET') return send(res, 200, persona.listBots());
      if (req.method === 'DELETE') { persona.deleteBot(url.searchParams.get('id') || ''); return send(res, 200, { ok: true }); }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (body.fromProfile) {
          // 내 프로필로 내 봇 만들기 (이름·말투·입버릇은 고친 값)
          const p = profilePath(body.user);
          if (!fs.existsSync(p)) return send(res, 400, { error: '취향 조사부터 해 주세요' });
          const card = persona.cardFromProfile(JSON.parse(fs.readFileSync(p, 'utf8')), body.edits || {});
          if (body.id) card.id = body.id;
          return send(res, 200, persona.publicCard(persona.saveBot(card, true)));
        }
        // 다른 사람의 봇 카드 불러오기
        if (!persona.validCard(body.card)) return send(res, 400, { error: '봇 카드 파일이 아니에요 (format gamebot-card/1)' });
        const { id, mine, ...card } = body.card;
        return send(res, 200, persona.publicCard(persona.saveBot(card, false)));
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/bots/export') {
      const c = persona.loadBot(url.searchParams.get('id') || '');
      if (!c) return send(res, 404, { error: 'none' });
      const fname = encodeURIComponent(`${c.name}.gamebot.json`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${fname}` });
      return res.end(JSON.stringify(persona.exportCard(c), null, 2));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, { ai: !!process.env.ANTHROPIC_API_KEY });
    }
    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      const body = await readBody(req);
      const likes = (body.likes || []).map(String).slice(0, 30);
      const dislikes = (body.dislikes || []).map(String).slice(0, 30);
      const rounds = (Array.isArray(body.rounds) ? body.rounds : []).slice(0, 12).map((r) => ({
        order: (r.order || []).map(String).slice(0, 6), unknown: (r.unknown || []).map(String).slice(0, 6),
      }));
      if (likes.length < 5) return send(res, 400, { error: '좋아하는 게임을 5개 이상 골라 주세요' });
      const art = (Array.isArray(body.art) ? body.art : []).slice(0, 8).map((r) => ({
        order: (r.order || []).slice(0, 6).filter((x) => x && ART_STYLES.includes(x.style)).map((x) => ({ game: String(x.game), style: x.style })),
      }));
      const useAI = !body.mock && !!process.env.ANTHROPIC_API_KEY;
      const result = useAI ? await aiAnalyze({ likes, dislikes, rounds, art }) : mockAnalyze({ likes, dislikes, art });
      const profile = { user: safeUser(body.user), mode: useAI ? 'ai' : 'rule', createdAt: new Date().toISOString(), likes, dislikes, rounds, artRounds: art, ...result };
      try { profile.persona = useAI ? await persona.aiPersona(profile) : persona.mockPersona(profile); }
      catch (e) { console.error('[gamebot] 결과지 문구 실패:', e.message); profile.persona = persona.mockPersona(profile); }
      fs.writeFileSync(profilePath(body.user), JSON.stringify(profile, null, 2));
      return send(res, 200, profile);
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (req.method === 'GET' && STATIC.has(file)) {
      return send(res, 200, fs.readFileSync(path.join(ROOT, file)), TYPES[path.extname(file)]);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    logError(`${req.method} ${url.pathname}`, e);
    // AI 키 쪽 흔한 오류는 사람 말로 (원문은 data/error.log)
    const m = String(e.message || '');
    const friendly = /credit balance/i.test(m) ? 'AI 키의 크레딧이 바닥났어요. console.anthropic.com 에서 충전하거나, 키 없이 쓰려면 key.txt 를 지우세요(무료 규칙 모드).'
      : /authentication|invalid x-api-key|401/i.test(m) ? 'AI 키가 맞지 않아요. key.txt 의 키를 다시 확인해 주세요.'
      : /rate limit|429|overloaded|529/i.test(m) ? 'AI 쪽이 지금 붐벼요. 잠시 뒤 다시 눌러 주세요.'
      : m;
    if (!res.headersSent) send(res, 500, { error: friendly });
  }
});

server.requestTimeout = 10 * 60 * 1000; // AI 분석·질문이 1~2분 걸릴 수 있음
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`[gamebot] ${PORT} 포트를 이미 쓰고 있어요. 겜잘알봇이 벌써 켜져 있는지 확인하고, 그 창을 닫은 뒤 다시 실행하세요.`);
  else logError('listen', e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('==================================================');
  console.log(`  🎮 겜잘알봇이 켜졌어요 →  http://localhost:${PORT}`);
  console.log(`  AI: ${process.env.ANTHROPIC_API_KEY ? '켜짐' : '꺼짐 (무료 규칙 모드 — key.txt 에 키를 넣으면 켜져요)'}`);
  console.log('  ⚠️  쓰는 동안 이 창을 닫지 마세요. (윈도우: 창 안을 클릭하면 멈춰요 — 멈췄으면 Esc)');
  console.log('==================================================');
});
