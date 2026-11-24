// 겜잘알봇 결과지 문구(persona) + 봇 카드. 스펙: docs/specs/gamebot.md "결과지·공유·봇 만들기"
// persona 는 분석(프로필)을 사용자 쪽에서 재밌게 읽히도록 다시 쓴 것 — 근거는 프로필 안의 사실만 쓴다.
const fs = require('fs');
const path = require('path');
const { GAMES } = require('./games.js');

const DATA = path.join(__dirname, 'data');
const BOTS = path.join(DATA, 'bots');
fs.mkdirSync(BOTS, { recursive: true });
const byName = new Map(GAMES.map((g) => [g.name, g]));

const PERSONA_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['emoji', 'type_name', 'tagline', 'traits', 'axis_lines', 'soulmates', 'nemesis', 'art_eye', 'quest_intro', 'bot'],
  properties: {
    emoji: { type: 'string' },
    type_name: { type: 'string' },
    tagline: { type: 'string' },
    traits: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['icon', 'label', 'desc'], properties: { icon: { type: 'string' }, label: { type: 'string' }, desc: { type: 'string' } } } },
    axis_lines: { type: 'array', items: { type: 'string' } },
    soulmates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['game', 'why'], properties: { game: { type: 'string' }, why: { type: 'string' } } } },
    nemesis: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['game', 'why'], properties: { game: { type: 'string' }, why: { type: 'string' } } } },
    art_eye: { type: 'string' },
    quest_intro: { type: 'string' },
    bot: { type: 'object', additionalProperties: false, required: ['name', 'emoji', 'voice', 'catchphrase'], properties: { name: { type: 'string' }, emoji: { type: 'string' }, voice: { type: 'string' }, catchphrase: { type: 'string' } } },
  },
};

const PERSONA_RULES = [
  '성향 테스트 결과지처럼 사용자가 읽고 "ㅋㅋ 나네" 할 수 있게 다시 써라. 친근한 "~해요"체, 놀리듯 다정하게. 과장·아부 금지, 근거는 프로필 안의 사실(게임·점수)만.',
  '- emoji: 이 타입을 나타내는 이모지 1개.',
  '- type_name: 별명형 타입 이름 6~14자 (예: "강화 버튼 앞의 장인", "조합 폭발 연금술사"). 장르명 그대로 쓰지 말 것.',
  '- tagline: 이 사람을 한 줄로 콕 찌르는 말(40자 안팎). 의외의 지점(예: 방치형을 만들면서 클리커는 꼴찌)을 살리면 좋다.',
  '- traits: 정확히 3개. icon(이모지)·label(8자 안팎 별명)·desc(한 줄, "~하는 타입" 식 구체 장면).',
  '- axis_lines: 축 5개 순서대로 각 한마디(25자 안팎, 점수 방향을 재밌게). 가운데(40~60)면 "가리지 않음" 쪽으로.',
  '- soulmates: 찰떡 게임 3개(좋아하는 게임 중), why 한 줄. nemesis: 상극 게임 2개(순위 꼴찌·싫어한 게임 중), why 한 줄 — 비하 말고 취향 차이로.',
  '- art_eye: 아트 취향을 "눈이 가는 그림 / 휙 넘기는 그림"으로 한 줄.',
  '- quest_intro: 취향 밖 추천(outside)을 "편식 탈출 퀘스트"로 소개하는 한 줄.',
  '- bot: 이 사람 취향을 이입한 봇. name(5~8자, "~봇"), emoji 1개, voice(말투·고집·좋아하고 시큰둥한 것 2~3문장 — 다른 봇과 토론할 때 성격이 드러나게), catchphrase(입버릇 한 줄).',
].join('\n');

function profileFacts(p) {
  return JSON.stringify({
    summary: p.summary, keywords: p.keywords, axes: p.axes, description: p.description, art: p.art,
    likes: (p.likes || []).slice(0, 12), bottoms: (p.rounds || []).map((r) => r.order[r.order.length - 1]).filter(Boolean),
    outside: p.outside, maker: p.maker,
  });
}

async function aiPersona(profile) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5', max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PERSONA_SCHEMA } },
    messages: [{ role: 'user', content: `${PERSONA_RULES}\n\n취향 프로필(JSON):\n${profileFacts(profile)}` }],
  });
  if (res.stop_reason === 'refusal') throw new Error('AI 가 결과지 쓰기를 거절했어요');
  console.log(`[gamebot] 결과지 문구 — 입력 ${res.usage?.input_tokens} / 출력 ${res.usage?.output_tokens} 토큰`);
  return JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
}

// 규칙 버전 (무료·시험용)
function mockPersona(p) {
  const ax = p.axes || [];
  const lean = (a) => (a.score >= 60 ? a.right : a.score <= 40 ? a.left : null);
  const leans = ax.map(lean).filter(Boolean);
  const kw = p.keywords || [];
  const likes = p.likes || [];
  const bottoms = (p.rounds || []).map((r) => r.order[r.order.length - 1]).filter(Boolean);
  const top = p.art?.styles?.[0]?.style;
  const low = p.art?.styles?.length ? p.art.styles[p.art.styles.length - 1].style : null;
  const name = `${leans[0] || '균형'} ${leans[1] || '탐험'}러`;
  return {
    emoji: '🎮', type_name: name,
    tagline: `${likes[0] || '좋아하는 게임'}부터 고른 당신, ${kw[0] || '취향'}에 진심인 타입이에요. (시험용 규칙 문구)`,
    traits: kw.slice(0, 3).map((k, i) => ({ icon: ['⭐', '🔥', '🧩'][i], label: k.slice(0, 10), desc: `${k} 쪽 게임을 먼저 고르는 타입` })),
    axis_lines: ax.map((a) => (lean(a) ? `${lean(a)} 쪽이 확실히 더 좋아요` : '어느 쪽이든 가리지 않아요')),
    soulmates: likes.slice(0, 3).map((g) => ({ game: g, why: '순위 상위' })),
    nemesis: bottoms.slice(0, 2).map((g) => ({ game: g, why: '판에서 꼴찌' })),
    art_eye: top ? `${top}에 눈이 가고${low && low !== top ? `, ${low}은(는) 휙 넘겨요` : ''}` : '아트 조사를 건너뛰었어요',
    quest_intro: '평소라면 안 고를 게임에서 훔쳐 올 것들',
    bot: { name: `${(leans[0] || '탐험').slice(0, 3)}봇`, emoji: '🤖', voice: `${kw.slice(0, 2).join('·')}을(를) 먼저 따지는 봇. (시험용 규칙 문구)`, catchphrase: '그래서 이거 재밌어요?' },
  };
}

// ── 봇 카드 ──
const FORMAT = 'gamebot-card/1';
const safe = (v, n) => String(v ?? '').slice(0, n);
function cardFromProfile(profile, edits = {}) {
  const b = { ...(profile.persona?.bot || {}), ...edits };
  return {
    format: FORMAT, kind: 'persona',
    name: safe(b.name || '내 봇', 30), emoji: safe(b.emoji || '🤖', 8),
    voice: safe(b.voice, 600), catchphrase: safe(b.catchphrase, 120),
    owner: safe(edits.owner || profile.user, 32), createdAt: new Date().toISOString(),
    profile: {
      type_name: profile.persona?.type_name || '', summary: profile.summary, keywords: profile.keywords,
      axes: (profile.axes || []).map(({ left, right, score }) => ({ left, right, score })),
      art: { summary: profile.art?.summary, styles: (profile.art?.styles || []).map(({ style, score }) => ({ style, score })) },
      likes: (profile.likes || []).slice(0, 12),
    },
  };
}
function validCard(c) {
  return c && c.format === FORMAT && (c.kind === 'persona' || c.kind === 'api') && c.name &&
    (c.kind === 'persona' ? !!c.profile : /^https?:\/\//.test(c.endpoint || ''));
}
function sanitizeCard(c) {
  const out = { format: FORMAT, kind: c.kind, name: safe(c.name, 30), emoji: safe(c.emoji || '🤖', 8), voice: safe(c.voice, 600), catchphrase: safe(c.catchphrase, 120), owner: safe(c.owner, 32), createdAt: safe(c.createdAt, 40) || new Date().toISOString() };
  if (c.kind === 'persona') {
    const p = c.profile || {};
    out.profile = {
      type_name: safe(p.type_name, 40), summary: safe(p.summary, 400), keywords: (p.keywords || []).slice(0, 10).map((k) => safe(k, 60)),
      axes: (p.axes || []).slice(0, 5).map((a) => ({ left: safe(a.left, 20), right: safe(a.right, 20), score: Math.max(0, Math.min(100, Number(a.score) || 0)) })),
      art: { summary: safe(p.art?.summary, 300), styles: (p.art?.styles || []).slice(0, 7).map((s) => ({ style: safe(s.style, 20), score: Math.max(0, Math.min(100, Number(s.score) || 0)) })) },
      likes: (p.likes || []).slice(0, 12).map((g) => safe(g, 80)),
    };
  } else {
    out.endpoint = safe(c.endpoint, 300);
    // 상대 서버 헤더(키)는 이 PC 의 data/ 에만 저장되고 목록·내보내기에는 나가지 않는다
    if (c.headers && typeof c.headers === 'object') out.headers = Object.fromEntries(Object.entries(c.headers).slice(0, 5).map(([k, v]) => [safe(k, 60), safe(v, 500)]));
  }
  return out;
}
const botId = (c) => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
function saveBot(card, mine) {
  const c = sanitizeCard(card);
  c.id = card.id && /^[a-z0-9]+$/.test(card.id) ? card.id : botId(c);
  c.mine = !!mine;
  fs.writeFileSync(path.join(BOTS, `${c.id}.json`), JSON.stringify(c, null, 2));
  return c;
}
const publicCard = (c) => { const { headers, ...rest } = c; return { ...rest, hasHeaders: !!headers }; };
function listBots() {
  return fs.readdirSync(BOTS).filter((f) => f.endsWith('.json')).map((f) => { try { return publicCard(JSON.parse(fs.readFileSync(path.join(BOTS, f), 'utf8'))); } catch { return null; } })
    .filter(Boolean).sort((a, b) => (b.mine - a.mine) || String(b.createdAt).localeCompare(String(a.createdAt)));
}
function loadBot(id) { try { return JSON.parse(fs.readFileSync(path.join(BOTS, `${String(id).replace(/[^a-z0-9]/g, '')}.json`), 'utf8')); } catch { return null; } }
function deleteBot(id) { const p = path.join(BOTS, `${String(id).replace(/[^a-z0-9]/g, '')}.json`); if (fs.existsSync(p)) fs.unlinkSync(p); }
function exportCard(c) { const { id, mine, headers, ...rest } = c; return rest; } // 내보낼 땐 키·내부 표시 빼기

module.exports = { aiPersona, mockPersona, cardFromProfile, validCard, saveBot, listBots, loadBot, deleteBot, exportCard, publicCard, byName };
