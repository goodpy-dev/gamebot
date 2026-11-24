// 겜잘알봇 질답 — 질문 → 레퍼런스 찾기(AI+웹 검색) → Steam 캡처 붙이기 → AI 가 맞는 캡처 고르기 → 보드 저장.
// 스펙: docs/specs/gamebot.md "2단계"
const fs = require('fs');
const path = require('path');
const { GAMES } = require('./games.js');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const BOARDS = path.join(DATA, 'boards');
fs.mkdirSync(BOARDS, { recursive: true });
const MODEL = 'claude-opus-5-5';
const byName = new Map(GAMES.map((g) => [g.name.toLowerCase(), g]));
const safeUser = (u) => String(u || 'me').replace(/[^a-zA-Z0-9가-힣_-]/g, '').slice(0, 32) || 'me';
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

// ── 캡처: media.js (Steam → 앱스토어 → 위키) ──
const media = require('./media.js');
// 카드마다 캡처 후보(최대 8장)를 붙인다. 고르기 전에는 Steam 은 2번째 장(첫 장은 로고·타이틀이 많음), 그 밖은 첫 장
async function attachShots(items) {
  await Promise.all(items.map(async (it) => {
    const m = await media.getMedia(it.game);
    it.source = m.source;
    it.shots = m.shots.slice(0, 8);
    it.shot = it.shots.length ? (m.source === 'steam' ? Math.min(1, it.shots.length - 1) : 0) : -1;
    it.shotKind = it.shots.length ? 'gameplay' : 'none';
    if (m.store && !it.store) it.store = m.store;
    if (!it.shots.length && m.cover) it.cover = m.cover;
  }));
}

// ── 재료: 프로필·원칙·게임 요약·피드백 ──
function context(user) {
  const profile = readJSON(path.join(DATA, `profile-${safeUser(user)}.json`), null);
  const fb = readJSON(path.join(DATA, `feedback-${safeUser(user)}.json`), []);
  const opt = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').trim(); } catch { return ''; } };
  const maker = opt('data/maker-profile.md');
  const game = opt('data/game-context.md');
  const prof = profile ? [
    `한 줄: ${profile.summary}`,
    `키워드: ${(profile.keywords || []).join(', ')}`,
    `축: ${(profile.axes || []).map((a) => `${a.left}↔${a.right} ${a.score}`).join(' / ')}`,
    `아트: ${profile.art?.summary || '-'} (${(profile.art?.styles || []).map((s) => `${s.style} ${s.score}`).join(', ')})`,
    `좋아하는 게임 순서: ${(profile.likes || []).slice(0, 12).join(', ')}`,
  ].join('\n') : '(아직 취향 조사를 안 함)';
  const likes = fb.filter((f) => f.vote > 0).slice(-15).map((f) => `${f.game}(${f.system})`);
  const hates = fb.filter((f) => f.vote < 0).slice(-15).map((f) => `${f.game}(${f.system})`);
  return { profile, prof, maker, game, likes, hates };
}

const KIND_KO = { similar: '닮은 쪽', opposite: '반대 쪽', wild: '엉뚱한 쪽' };

function systemPrompt(ctx) {
  return [
    '너는 "겜잘알봇"이다. 게임 개발자의 고민을 실제 게임 레퍼런스를 근거로 진단하고, "그래서 이렇게 바꾸자"는 제안까지 내는 기획 파트너다. 추천안 하나와 다른 방향 하나를 대가와 함께 내고, 고르는 건 개발자다.',
    '모든 글은 한국어, 짧고 구체적으로. 존댓말.',
    '',
    '## 이 사람의 취향 프로필', ctx.prof,
    ctx.likes.length ? `좋다고 한 레퍼런스: ${ctx.likes.join(', ')}` : '',
    ctx.hates.length ? `별로라고 한 레퍼런스: ${ctx.hates.join(', ')}` : '',
    ...(ctx.maker ? ['', '## 만드는 사람으로서의 원칙', ctx.maker] : []),
    ...(ctx.game ? ['', '## 지금 만드는 게임', ctx.game] : []),
    '',
    '## 답하는 법',
    ctx.game
      ? '1. 질문이 우리 게임의 어떤 부분인지 잡고, 지금 구조가 어떤 실제 게임의 어떤 시스템/화면과 닮았는지 짚는다(current). 확신 없으면 current 를 null.'
      : '1. 질문(과 붙인 화면)이 가리키는 구조가 어떤 실제 게임의 어떤 시스템/화면과 닮았는지 짚는다(current). 질문만으로 알 수 없으면 current 를 null.',
    '2. 레퍼런스 5~6개: similar(지금 구조를 더 잘 만든 사례) 2개, opposite(정반대 접근) 2개, wild(다른 장르에서 빌려 올 것) 1~2개.',
    '   - 반드시 실제로 존재하는 게임과 그 게임에 실제로 있는 시스템/화면만. 기억이 흐리면 웹 검색으로 확인한다.',
    '   - 최소 1개는 이 사람의 취향 밖(outside_taste: true). 이미 보여 준 게임은 다시 쓰지 않는다.',
    '   - game 은 Steam 에 올라간 정식 이름(영문 원제 우선)으로. Steam 에 없는 게임이면 흔히 쓰는 이름.',
    '   - source_url 은 웹 검색에서 실제로 본 주소(위키·공식·UI 아카이브·리뷰)만. 없으면 빈 문자열.',
    '3. 진단(diagnosis) 1~3개: 사용자가 느끼는 문제(체감)와 그 원인을 지금 구조에서 구체적으로 짚는다. 질문·화면·게임 요약에서 본 실제 문구·수치를 근거로.',
    '4. 결론·제안(proposal): 레퍼런스를 늘어놓고 끝내지 않는다. "그래서 이렇게 바꾸자"를 낸다.',
    '   - headline: 결론 한 문장 (무엇은 그대로 두고 무엇을 바꾸는지).',
    '   - steps 2~5개: do(바꿀 것) · how(전→후 예시) · from(참고한 refs 의 게임 이름) · scope(표시 = 화면·문구만 / 규칙 = 동작·밸런스가 바뀜 / 콘텐츠 = 새로 만들 것).',
    '   - skip: 이번 제안에서 일부러 뺀 레퍼런스·방향과 이유 한 줄.',
    '   - alt: 다른 방향 하나(direction)와 그 대가(tradeoff). 추천과 섞지 않는다.',
    '   - first: 바로 시작할 첫 걸음 한 줄.',
    '   - 확인하지 못한 가정은 "확인 안 함"이라고 쓴다.',
    '5. 마지막에 되묻기(ask) 한 문장: 제안대로 갈지, 다른 방향(alt)으로 갈지 고르게.',
    '',
    '웹 검색은 필요한 만큼만(최대 5번). 최종 답은 아래 JSON 하나를 <answer> 와 </answer> 사이에 넣는다. JSON 밖에 다른 설명을 붙이지 않는다.',
    '{"reply":"2~3문장 총평","current":{"game":"","system":"","why":""}|null,',
    ' "diagnosis":[{"problem":"체감 한 줄","cause":"원인 한 줄"}],',
    ' "proposal":{"headline":"결론 한 문장","steps":[{"do":"","how":"전→후 예시","from":"참고 게임","scope":"표시|규칙|콘텐츠"}],"skip":"","alt":{"direction":"","tradeoff":""},"first":""},',
    ' "refs":[{"kind":"similar|opposite|wild","game":"","system":"어떤 시스템/화면","take":"가져올 점 한 줄","why_you":"이 사람 취향과의 연결 한 줄","outside_taste":false,"source_url":""}],',
    ' "ask":"되묻기 한 문장"}',
  ].filter((l) => l !== '').join('\n');
}

function parseAnswer(text) {
  const m = [...text.matchAll(/<answer>([\s\S]*?)<\/answer>/g)].pop();
  const raw = (m ? m[1] : text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  return JSON.parse(raw.slice(a, b + 1));
}

// ── AI 찾기 (호출 ①) ──
async function aiFind({ question, image, history, more, ctx }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const shown = history.flatMap((h) => h.games || []);
  const lines = [
    history.length ? '## 앞선 대화' : '',
    ...history.slice(-6).map((h, i) => `${i + 1}. 질문: ${h.q}\n   보여 준 게임: ${(h.games || []).join(', ')}${h.pick ? `\n   고른 방향: ${h.pick}` : ''}`),
    shown.length ? `이미 보여 준 게임(다시 쓰지 말 것): ${[...new Set(shown)].join(', ')}` : '',
    '',
    `## 질문\n${question}`,
    more ? `\n이번에는 "${KIND_KO[more]}" 레퍼런스를 더 원한다. 그 묶음을 4개로 늘리고 나머지는 1개씩.` : '',
    image ? '\n(붙인 이미지는 이 사람이 고민 중인 화면 캡처다. 화면을 보고 지금 구조를 짚어라.)' : '',
  ].filter(Boolean).join('\n');
  const content = [];
  if (image) {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(image);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: lines });
  const messages = [{ role: 'user', content }];
  let usage = { input: 0, output: 0, searches: 0 };
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: systemPrompt(ctx),
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages,
    });
    usage.input += res.usage?.input_tokens || 0; usage.output += res.usage?.output_tokens || 0;
    usage.searches += res.usage?.server_tool_use?.web_search_requests || 0;
    if (res.stop_reason === 'refusal') throw new Error('AI 가 답을 거절했어요');
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { answer: parseAnswer(text), usage };
  }
  throw new Error('AI 가 답을 끝내지 못했어요');
}

// ── AI 캡처 고르기 (호출 ②): 카드마다 질문에 맞는 스크린샷 하나 ──
const PICK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['card', 'shot', 'kind', 'caption'],
        properties: {
          card: { type: 'integer' }, shot: { type: 'integer' },
          kind: { type: 'string', enum: ['ui', 'gameplay', 'none'] }, caption: { type: 'string' },
        },
      },
    },
  },
};
async function aiPickShots(question, items) {
  const withShots = items.map((it, i) => ({ it, i })).filter(({ it }) => it.shots.length);
  if (!withShots.length) return { input: 0, output: 0 };
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const content = [{
    type: 'text',
    text: `질문: "${question}"\n아래는 카드마다 그 게임의 Steam 스크린샷 후보다. 카드마다 질문과 그 카드의 시스템을 가장 잘 보여 주는 한 장을 골라라.\n` +
      '- 그 시스템의 UI 화면이 보이면 kind "ui", 아니면 가장 분위기를 잘 보여 주는 플레이 화면 "gameplay", 맞는 게 전혀 없으면 shot -1 · "none".\n' +
      '- caption 은 그 캡처에서 볼 곳 한 줄(한국어). 보이지 않는 걸 보인다고 쓰지 말 것.',
  }];
  for (const { it, i } of withShots) {
    content.push({ type: 'text', text: `\n[카드 ${i}] ${it.game} — ${it.system}` });
    it.shots.slice(0, 6).forEach((url, j) => {
      content.push({ type: 'text', text: `[카드 ${i} · 후보 ${j}]` });
      content.push({ type: 'image', source: { type: 'url', url } });
    });
  }
  const res = await client.messages.create({
    model: MODEL, max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PICK_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason !== 'refusal') {
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    for (const p of JSON.parse(text).picks || []) {
      const it = items[p.card]; if (!it) continue;
      it.shotKind = p.kind;
      it.caption = p.caption;
      if (p.shot >= 0 && p.shot < Math.min(6, it.shots.length)) it.shot = p.shot;
    }
  }
  return { input: res.usage?.input_tokens || 0, output: res.usage?.output_tokens || 0 };
}

// ── 시험용 가짜 답 (AI 없이 게임 목록에서 고름) ──
function mockFind({ question, history, more, ctx }) {
  const shown = new Set(history.flatMap((h) => h.games || []));
  const pool = GAMES.filter((g) => (g.steam || g.ios) && !shown.has(g.name));
  const likes = new Set(ctx.profile?.likes || []);
  const vec = ctx.profile?.axes ? ctx.profile.axes.map((a) => (a.score / 100) * 4 - 2) : [0, 0, 0, 0, 0];
  const dist = (g) => g.ax.reduce((a, v, k) => a + (v - vec[k]) ** 2, 0);
  const near = [...pool].sort((a, b) => dist(a) - dist(b));
  const n = { similar: 2, opposite: 2, wild: 1 };
  if (more) { n.similar = n.opposite = n.wild = 1; n[more] = 4; }
  const used = new Set();
  const take = (arr, k) => arr.filter((g) => !used.has(g.name)).slice(0, k).map((g) => { used.add(g.name); return g; });
  const sim = take(near, n.similar);
  const opp = take([...near].reverse(), n.opposite);
  const wild = take(pool.sort(() => Math.random() - 0.5).filter((g) => !sim.concat(opp).some((s) => s.genres[0] === g.genres[0])), n.wild);
  const card = (kind) => (g) => ({
    kind, game: g.name, system: g.kw[0], take: `${g.kw.join(' · ')} 쪽을 참고`,
    why_you: likes.has(g.name) ? '좋아한다고 고른 게임이에요' : `${g.genres.join('·')} — 시험용 규칙 추천`,
    outside_taste: kind === 'opposite', source_url: '',
  });
  const cur = near.find((g) => likes.has(g.name)) || near[0];
  return {
    answer: {
      reply: `(시험용 가짜 답 — AI 를 부르지 않았어요) "${question}"에 대해 게임 목록에서 규칙으로 골랐어요.`,
      current: cur ? { game: cur.name, system: cur.kw[0], why: '시험용: 취향 축이 가장 가까운 게임' } : null,
      refs: [...sim.map(card('similar')), ...opp.map(card('opposite')), ...wild.map(card('wild'))],
      diagnosis: [{ problem: '(시험용) 질문에서 느낀 문제', cause: '(시험용) 규칙 모드라 원인은 짚지 않았어요' }],
      proposal: {
        headline: '(시험용) 닮은 쪽 레퍼런스를 바탕으로 다듬는 안',
        steps: sim.map((g) => ({ do: `${g.kw[0]} 참고`, how: g.kw.join(' · '), from: g.name, scope: '표시' })),
        skip: opp[0] ? `${opp[0].name} 쪽은 이번엔 뺌 (시험용)` : '',
        alt: opp[0] ? { direction: `${opp[0].name} 처럼 정반대로 가기`, tradeoff: '(시험용) 공사가 큼' } : null,
        first: '(시험용) 첫 걸음',
      },
      ask: '이 제안대로 갈까요, 아니면 반대 방향으로 갈까요?',
    },
    usage: { input: 0, output: 0, searches: 0 },
  };
}

// ── 보드 ──
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function saveBoard(b) { fs.writeFileSync(path.join(BOARDS, `${b.id}.json`), JSON.stringify(b, null, 2)); return b; }
function loadBoard(id) { return readJSON(path.join(BOARDS, `${String(id).replace(/[^a-z0-9]/g, '')}.json`), null); }

function clean(answer) {
  const s = (v, n = 400) => String(v ?? '').slice(0, n);
  const kinds = ['similar', 'opposite', 'wild'];
  return {
    reply: s(answer.reply, 800),
    current: answer.current && answer.current.game ? { game: s(answer.current.game, 80), system: s(answer.current.system), why: s(answer.current.why) } : null,
    refs: (answer.refs || []).slice(0, 10).filter((r) => r && r.game && kinds.includes(r.kind)).map((r) => ({
      kind: r.kind, game: s(r.game, 80), system: s(r.system), take: s(r.take), why_you: s(r.why_you),
      outside_taste: !!r.outside_taste, source_url: /^https?:\/\//.test(r.source_url || '') ? s(r.source_url, 500) : '',
    })),
    diagnosis: (Array.isArray(answer.diagnosis) ? answer.diagnosis : []).slice(0, 4).filter((d) => d && d.problem)
      .map((d) => ({ problem: s(d.problem, 200), cause: s(d.cause, 300) })),
    proposal: cleanProposal(answer.proposal, s),
    ask: s(answer.ask),
  };
}

const SCOPES = ['표시', '규칙', '콘텐츠'];
function cleanProposal(p, s) {
  if (!p || !p.headline) return null;
  const steps = (Array.isArray(p.steps) ? p.steps : []).slice(0, 6).filter((x) => x && x.do).map((x) => ({
    do: s(x.do, 200), how: s(x.how, 400), from: s(x.from, 80), scope: SCOPES.includes(x.scope) ? x.scope : '',
  }));
  const alt = p.alt && p.alt.direction ? { direction: s(p.alt.direction, 300), tradeoff: s(p.alt.tradeoff, 300) } : null;
  return { headline: s(p.headline, 300), steps, skip: s(p.skip, 300), alt, first: s(p.first, 300) };
}

async function buildBoard({ user, question, answer, usage, via, pick }) {
  const a = clean(answer);
  const items = [...(a.current ? [a.current] : []), ...a.refs];
  await attachShots(items);
  let pickUsage = { input: 0, output: 0 };
  if (pick && items.some((it) => it.shots.length)) {
    try { pickUsage = await aiPickShots(question, items); } catch (e) { console.error('[gamebot] 캡처 고르기 실패:', e.message); }
  }
  const b = { id: newId(), user: safeUser(user), createdAt: new Date().toISOString(), via, question: String(question).slice(0, 500), ...a, usage: { ...usage, pick: pickUsage } };
  return saveBoard(b);
}

// 웹 앱 질문: 찾기 → 캡처 → 고르기 → 저장
async function ask({ user, question, image, history = [], more, mock }) {
  const ctx = context(user);
  const useAI = !mock && !!process.env.ANTHROPIC_API_KEY;
  const { answer, usage } = useAI ? await aiFind({ question, image, history, more, ctx }) : mockFind({ question, history, more, ctx });
  const b = await buildBoard({ user, question, answer, usage, via: useAI ? 'ai' : 'mock', pick: useAI });
  if (useAI) console.log(`[gamebot] 질문 처리 — 찾기 입력 ${usage.input}/출력 ${usage.output}·검색 ${usage.searches}회, 캡처 고르기 입력 ${b.usage.pick.input}/출력 ${b.usage.pick.output}`);
  return b;
}

function saveFeedback({ user, game, system, kind, vote }) {
  const p = path.join(DATA, `feedback-${safeUser(user)}.json`);
  const fb = readJSON(p, []).filter((f) => !(f.game === game && f.system === system));
  if (vote) fb.push({ game: String(game).slice(0, 80), system: String(system || '').slice(0, 200), kind, vote: vote > 0 ? 1 : -1, at: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify(fb.slice(-200), null, 2));
  return { ok: true, count: fb.length };
}

module.exports = { ask, buildBoard, loadBoard, saveFeedback, context };
