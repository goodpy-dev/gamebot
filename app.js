// 겜잘알봇 화면 — 1부 게임성(표지 4개 순위) → 2부 아트(이름 가린 스크린샷 4장 순위) → 정리 → 취향 프로필.
// 스펙: docs/specs/gamebot.md
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const USER = params.get('user') || 'me';
const MOCK = params.get('mock') === '1';
const ROUNDS = 8;      // 게임성 판 수
const MIN_ROUNDS = 5;  // 이만큼 하면 아트 조사로 넘어갈 수 있음
const ART_ROUNDS = 4;  // 아트 판 수
const PER = 4;         // 한 판 카드 수

const byName = new Map(GAMES.map((g) => [g.name, g]));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let S; // 진행 상태
const VIEWS = ['onboard', 'review', 'profile', 'askView', 'boardView', 'botsView'];
function showView(v) {
  VIEWS.forEach((x) => { $(x).hidden = x !== v; });
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('on', (t.dataset.view === 'ask' && v === 'askView') || (t.dataset.view === 'me' && ['onboard', 'review', 'profile'].includes(v)) || (t.dataset.view === 'bots' && v === 'botsView')));
}
function freshState() {
  return { phase: 'game', rounds: [], cur: null, seen: new Set(), custom: [], art: [], artSeen: new Set(), artShown: {} };
}

// Steam 표지: 세로 표지 → 옛 주소 → 가로 머리그림 → 이름 타일
const covers = (id) => [
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
];
const rankScore = (i, k) => (k === 1 ? 0.75 : 1 - i / (k - 1));

// ── 1부 게임성 점수: 한 판에서 아는 게임 k개 중 r등(0부터) → 1 - r/(k-1), 여러 판이면 평균 ──
function scores() {
  const sum = new Map(), cnt = new Map();
  for (const r of S.rounds) {
    r.order.forEach((n, i) => {
      sum.set(n, (sum.get(n) || 0) + rankScore(i, r.order.length)); cnt.set(n, (cnt.get(n) || 0) + 1);
    });
  }
  return new Map([...sum].map(([n, s]) => [n, s / cnt.get(n)]));
}

function prefVector() {
  const top = [...scores()].filter(([n, s]) => s >= 0.66 && byName.has(n));
  if (!top.length) return null;
  return [0, 1, 2, 3, 4].map((k) => top.reduce((a, [n]) => a + byName.get(n).ax[k], 0) / top.length);
}

// 다음 게임성 판: 처음 2판은 장르 고루, 그 뒤로 취향 가까운 것 2 + 아무거나 1 + 먼 것 1
function pickRound() {
  const pool = shuffle(GAMES.filter((g) => !S.seen.has(g.name)));
  const vec = S.rounds.length >= 2 ? prefVector() : null;
  const out = [];
  const usedGenre = new Set();
  const take = (g) => { if (g && !out.includes(g)) { out.push(g); usedGenre.add(g.genres[0]); } };
  if (!vec) {
    for (const g of pool) { if (out.length >= PER) break; if (!usedGenre.has(g.genres[0])) take(g); }
  } else {
    const dist = (g) => g.ax.reduce((a, v, k) => a + (v - vec[k]) ** 2, 0);
    const near = [...pool].sort((a, b) => dist(a) - dist(b));
    for (const g of near) { if (out.length >= 2) break; if (!usedGenre.has(g.genres[0])) take(g); }
    take(pool.find((g) => !out.includes(g) && !usedGenre.has(g.genres[0])));
    take([...near].reverse().find((g) => !out.includes(g)));
  }
  for (const g of pool) { if (out.length >= PER) break; take(g); }
  out.forEach((g) => S.seen.add(g.name));
  return { games: shuffle(out.map((g) => g.name)), order: [], unknown: [] };
}

// ── 2부 아트 점수: 화풍별 평균 (게임성과 섞지 않음) ──
function artScores() {
  const sum = {}, cnt = {};
  for (const r of S.art) {
    r.order.forEach((name, i) => {
      const st = byName.get(name).art;
      sum[st] = (sum[st] || 0) + rankScore(i, r.order.length); cnt[st] = (cnt[st] || 0) + 1;
    });
  }
  return ART_STYLES.filter((s) => cnt[s]).map((s) => ({ style: s, score: sum[s] / cnt[s] })).sort((a, b) => b.score - a.score);
}

// 다음 아트 판: 서로 다른 화풍 4개. 처음 2판은 덜 나온 화풍 위주, 그 뒤로 지금 1등 화풍 + 덜 나온 화풍 3
async function pickArtRound() {
  const avail = (st) => GAMES.filter((g) => (g.steam || g.ios) && g.art === st && !S.artSeen.has(g.name));
  const styles = shuffle(ART_STYLES.filter((st) => avail(st).length))
    .sort((a, b) => (S.artShown[a] || 0) - (S.artShown[b] || 0));
  let chosen = styles.slice(0, PER);
  if (S.art.length >= 2) {
    const top = artScores()[0]?.style;
    if (top && avail(top).length && !chosen.includes(top)) chosen = [top, ...styles.filter((s) => s !== top).slice(0, PER - 1)];
  }
  const games = chosen.map((st) => shuffle(avail(st))[0]);
  games.forEach((g) => { S.artSeen.add(g.name); S.artShown[g.art] = (S.artShown[g.art] || 0) + 1; });
  const cur = { games: shuffle(games.map((g) => g.name)), order: [], unknown: [], shots: {} };
  await Promise.all(cur.games.map(async (n) => {
    try {
      const r = await fetch(`/api/shot?name=${encodeURIComponent(n)}`);
      if (r.ok) cur.shots[n] = (await r.json()).url;
    } catch { /* 이름 타일로 대체 */ }
  }));
  return cur;
}

// Steam 이 아닌 게임 표지 (앱스토어 아이콘·위키 표지) — 서버가 찾아 줌
const coverCache = new Map();
async function fillCover(el) {
  const name = el.dataset.media;
  let m = coverCache.get(name);
  if (!m) { try { m = await fetch(`/api/media?name=${encodeURIComponent(name)}`).then((r) => r.json()); } catch { m = {}; } coverCache.set(name, m); }
  if (!m.cover || !el.isConnected) return;
  const img = Object.assign(document.createElement('img'), { src: m.cover, alt: '', className: m.icon ? 'icon' : '' });
  img.onload = () => {
    if (!el.isConnected) return;
    if (m.icon) { const w = document.createElement('div'); w.className = 'iconwrap'; w.style.setProperty('--bg', `url("${m.cover}")`); w.append(img); el.replaceWith(w); }
    else el.replaceWith(img);
  };
}

// ── 한 판 화면 (게임성·아트 공용) ──
function renderRound() {
  const c = S.cur;
  const art = S.phase === 'art';
  const done = art ? S.art.length : S.rounds.length;
  const total = art ? ART_ROUNDS : ROUNDS;
  $('partTag').textContent = art ? '2부 · 아트 취향' : '1부 · 게임성';
  $('roundTitle').textContent = art ? '그림만 보고 끌리는 순서대로 눌러 주세요' : '해 본 게임만 좋아하는 순서대로 눌러 주세요';
  $('roundSub').innerHTML = art
    ? '게임 이름은 가렸어요. 재미 말고 <b>그림·화풍</b>만 보고 골라 주세요.'
    : '안 누른 게임은 <b>안 해봤어요</b>로 넘어가요. 다시 누르면 취소돼요.';
  $('roundNo').textContent = `${done + 1} / ${total} 판`;
  $('pfill').style.width = `${(done / total) * 100}%`;
  $('cards').classList.toggle('art', art);
  $('cards').innerHTML = c.games.map((name) => {
    const g = byName.get(name);
    const r = c.order.indexOf(name);
    let pic;
    if (art) pic = c.shots[name] ? `<img alt="" src="${esc(c.shots[name])}">` : `<div class="ph">${esc(g.art)}</div>`;
    else pic = g.steam ? `<img alt="" data-i="0" data-id="${g.steam}" src="${covers(g.steam)[0]}">` : `<div class="ph" data-media="${esc(name)}">${esc(name)}</div>`;
    return `<div class="card${r >= 0 ? ' ranked' : ''}" data-name="${esc(name)}">
      <div class="art">${pic}${r >= 0 ? `<div class="rank">${r + 1}</div>` : ''}</div>
      <div class="title">${esc(name)}</div><div class="tags">${esc(g.genres.join(' · '))} — ${esc(g.kw.slice(0, 2).join(', '))}</div></div>`;
  }).join('');
  if (!art) {
    $('cards').querySelectorAll('[data-media]').forEach(fillCover);
    $('cards').querySelectorAll('img[data-id]').forEach((img) => {
      img.onerror = () => {
        const i = Number(img.dataset.i) + 1;
        const urls = covers(img.dataset.id);
        if (i < urls.length) { img.dataset.i = i; img.src = urls[i]; }
        else img.replaceWith(Object.assign(document.createElement('div'), { className: 'ph', textContent: img.closest('.card').dataset.name }));
      };
    });
  }
  // 게임성: 해 본 것만 누르고 언제든 다음 (안 누른 건 안 해봤어요) · 아트: 4장 다 순위를 매겨야 다음
  $('next').disabled = art ? c.order.length < c.games.length : false;
  const last = done + 1 >= total;
  $('next').textContent = !art && !c.order.length ? (last ? '다 안 해봤어요 → 아트 조사로' : '다 안 해봤어요 →')
    : last ? (art ? '다 했어요' : '아트 조사로') : '다음';
  $('skipAll').hidden = !art;
  $('skipAll').textContent = '이 판 건너뛰기';
  $('back').hidden = !canGoBack();
  saveProgress();
  $('early').hidden = art ? S.art.length < 2 : S.rounds.length < MIN_ROUNDS;
  $('finishEarly').textContent = art ? '아트는 여기까지 → 정리' : '게임성은 여기까지 → 아트 조사로';
}

function clickCard(name) {
  const c = S.cur;
  const i = c.order.indexOf(name);
  if (i >= 0) c.order.splice(i, 1); else c.order.push(name);
  if (S.phase === 'art') {
    // 아트는 4장 다 매기니까 하나만 남으면 자동으로 꼴찌 자리에
    const rest = c.games.filter((n) => !c.order.includes(n));
    if (i < 0 && rest.length === 1 && c.order.length >= 1) c.order.push(rest[0]);
  }
  renderRound();
}

let busy = false;
async function loadArtRound() {
  busy = true;
  $('cards').innerHTML = '<p style="color:var(--dim)">스크린샷을 가져오는 중…</p>';
  S.cur = await pickArtRound();
  busy = false;
  renderRound();
}

async function startArt() {
  S.phase = 'art';
  await loadArtRound();
}

async function nextRound(skip = false) {
  if (busy) return;
  if (S.phase === 'game') {
    S.cur.unknown = S.cur.games.filter((n) => !S.cur.order.includes(n));
    S.rounds.push(S.cur);
    if (S.rounds.length >= ROUNDS) return startArt();
    S.cur = pickRound();
    return renderRound();
  }
  if (!skip && S.cur.order.length) S.art.push(S.cur);
  if (S.art.length >= ART_ROUNDS || S.artSeen.size >= GAMES.filter((g) => g.steam || g.ios).length) return showReview();
  await loadArtRound();
}

// ── 뒤로 가기: 바로 전 판으로 (그 판의 순위가 남아 있어 고칠 수 있음) ──
function canGoBack() {
  return S.phase === 'art' ? (S.art.length > 0 || S.rounds.length > 0) : S.rounds.length > 0;
}
function dropCur() {
  // 지금 판에 나온 카드는 다시 나올 수 있게 돌려놓기
  if (!S.cur) return;
  if (S.phase === 'art') S.cur.games.forEach((n) => { S.artSeen.delete(n); const st = byName.get(n).art; S.artShown[st] = Math.max(0, (S.artShown[st] || 1) - 1); });
  else S.cur.games.forEach((n) => S.seen.delete(n));
}
function goBack() {
  if (busy || !canGoBack()) return;
  dropCur();
  if (S.phase === 'art' && S.art.length) S.cur = S.art.pop();
  else { S.phase = 'game'; S.cur = S.rounds.pop(); S.cur.unknown = []; }
  showView('onboard');
  renderRound();
}
function backFromReview() {
  // 정리 화면 → 마지막으로 매긴 판
  if (S.art.length) { S.phase = 'art'; S.cur = S.art.pop(); }
  else if (S.rounds.length) { S.phase = 'game'; S.cur = S.rounds.pop(); S.cur.unknown = []; }
  else return;
  showView('onboard');
  renderRound();
}

// ── 진행 저장: 새로 고침·서버 재시작에도 이어서 (분석 성공하면 지움) ──
const SAVE_KEY = `gamebot-survey-${USER}`;
function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...S, seen: [...S.seen], artSeen: [...S.artSeen], view: VIEWS.find((v) => !$(v).hidden) }));
  } catch { /* 저장 못 해도 진행은 됨 */ }
}
function loadProgress() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d || !d.cur) return null;
    return { ...d, seen: new Set(d.seen), artSeen: new Set(d.artSeen) };
  } catch { return null; }
}
function clearProgress() { try { localStorage.removeItem(SAVE_KEY); } catch { /* 없음 */ } }

// ── 정리 화면 ──
function likesOrder() {
  const ranked = [...scores()].sort((a, b) => b[1] - a[1]);
  let likes = ranked.filter(([, s]) => s >= 0.5).map(([n]) => n);
  if (likes.length < 5) likes = ranked.slice(0, Math.max(5, likes.length)).map(([n]) => n);
  return [...S.custom, ...likes.filter((n) => !S.custom.includes(n))];
}

function showReview() {
  showView('review');
  const likes = likesOrder();
  $('rOrder').innerHTML = likes.map((n, i) => `<span class="pk${S.custom.includes(n) ? ' custom' : ''}"><b>${i + 1}</b>${esc(n)}</span>`).join('');
  const as = artScores();
  $('rArt').textContent = as.length ? `아트: ${as.map((a) => `${a.style} ${Math.round(a.score * 100)}`).join(' > ')}` : '아트 조사는 건너뛰었어요';
  $('analyze').disabled = likes.length < 5;
  saveProgress();
}

async function analyze() {
  $('loadingText').textContent = '취향을 읽는 중…';
  $('loading').hidden = false;
  try {
    const rounds = S.rounds.map((r) => ({ order: r.order, unknown: r.unknown }));
    const art = S.art.map((r) => ({ order: r.order.map((n) => ({ game: n, style: byName.get(n).art })) }));
    const r = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: USER, likes: likesOrder(), dislikes: [], rounds, art, mock: MOCK }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    window.PROFILE = data;
    clearProgress();
    showProfile(data);
  } catch (e) {
    if (e instanceof TypeError) {
      alert('봇 서버(검은 창)에 연결이 안 돼요.\n\n검은 창이 꺼졌으면 다시 실행하고, 켜져 있으면 창 안을 한 번 클릭한 뒤 Esc 를 눌러 주세요(윈도우는 창을 클릭하면 멈춰요).\n그 다음 \'취향 분석\'을 다시 누르면 돼요. 고른 순위는 그대로 남아 있어요.');
    } else alert('분석 실패: ' + e.message);
  } finally {
    $('loading').hidden = true;
  }
}

// ── 프로필 화면은 profile-ui.js (결과지·공유·봇) ──

function startOnboard(fresh) {
  const saved = fresh ? null : loadProgress();
  if (saved) {
    S = saved;
    if (saved.view === 'review') return showReview();
  } else {
    S = freshState();
    S.cur = pickRound();
  }
  showView('onboard');
  renderRound();
}

// ── 연결 ──
$('cards').onclick = (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  clickCard(card.dataset.name);
};
$('back').onclick = goBack;
$('reviewBack').onclick = backFromReview;
$('next').onclick = () => nextRound();
$('undo').onclick = () => { S.cur.order = []; S.cur.unknown = []; renderRound(); };
$('skipAll').onclick = () => { S.cur.order = []; nextRound(true); };
$('finishEarly').onclick = () => {
  if (busy) return;
  if (S.phase === 'game') { if (S.cur.order.length) S.rounds.push(S.cur); startArt(); }
  else { if (S.cur.order.length) S.art.push(S.cur); showReview(); }
};
const addCustom = () => {
  const name = $('customName').value.trim();
  if (!name || S.custom.includes(name)) return;
  S.custom.push(name); $('customName').value = ''; showReview();
};
$('customAdd').onclick = addCustom;
$('customName').onkeydown = (e) => { if (e.key === 'Enter') addCustom(); };
$('restart').onclick = () => { if (confirm('지금까지 고른 걸 지우고 처음부터 할까요?')) { clearProgress(); startOnboard(true); } };
$('analyze').onclick = analyze;
$('toAsk').onclick = () => showAsk();
$('tabs').onclick = async (e) => {
  const t = e.target.closest('.tab'); if (!t) return;
  if (t.dataset.view === 'ask') return showAsk();
  if (t.dataset.view === 'bots') return showBots();
  const r = await fetch(`/api/profile?user=${encodeURIComponent(USER)}`);
  if (r.ok) showProfile(await r.json()); else startOnboard();
};
$('redo').onclick = async () => {
  if (!confirm('지금 프로필을 지우고 처음부터 다시 할까요?')) return;
  await fetch(`/api/profile?user=${encodeURIComponent(USER)}`, { method: 'DELETE' });
  clearProgress();
  startOnboard(true);
};

(async function init() {
  const st = await fetch('/api/status').then((r) => r.json()).catch(() => ({ ai: false }));
  $('modeTag').textContent = MOCK || !st.ai ? '규칙 분석 모드 (무료)' : 'AI 분석 모드';
  window.AI_ON = !MOCK && st.ai;
  if (params.get('board')) return showBoardPage(params.get('board'));
  const r = await fetch(`/api/profile?user=${encodeURIComponent(USER)}`);
  if (r.ok) { window.PROFILE = await r.json(); showAsk(); } else startOnboard();
})();
