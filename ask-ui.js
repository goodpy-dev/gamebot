// 겜잘알봇 질답 화면 — 질문 → 보드(총평 · 진단 · 제안 · 근거 레퍼런스 카드 · 되묻기). 스펙: docs/specs/gamebot.md "2단계"
const KIND = {
  current: { icon: '📍', name: '지금 구조와 닮은 것' },
  similar: { icon: '🟣', name: '닮은 쪽 — 지금 구조를 더 잘 만든 사례' },
  opposite: { icon: '🔵', name: '반대 쪽 — 정반대 접근' },
  wild: { icon: '🟠', name: '엉뚱한 쪽 — 다른 장르에서 빌려 오기' },
};
const SHOT_KIND = { ui: 'UI 화면', gameplay: '플레이 화면', none: '맞는 캡처 없음' };
const askState = { history: [], image: '', busy: false };
const boards = new Map(); // id → board (다른 캡처 넘기기용)

function showAsk() {
  showView('askView');
  const p = window.PROFILE;
  $('askHint').innerHTML = p
    ? `${esc(p.persona?.emoji || '🎮')} <b>${esc(p.persona?.type_name || p.summary)}</b> 취향으로 골라 드려요 · 👀 ${esc(p.persona?.art_eye || p.art?.summary || '-')}`
    : '아직 취향 조사를 안 했어요. <a href="#" id="goOnboard">취향 조사부터</a> 하면 더 잘 맞춰요.';
  const go = $('goOnboard'); if (go) go.onclick = (e) => { e.preventDefault(); startOnboard(); };
  $('cost').textContent = window.AI_ON ? '한 번 물을 때 AI 호출 2회(웹 검색 포함)' : '시험 모드 — AI 를 부르지 않아요';
  if (!$('thread').children.length) {
    $('thread').innerHTML = `<div class="empty">
      <p>막연한 의견도 좋아요. 지금 구조가 어떤 게임과 닮았는지 짚고, 닮은 쪽·반대 쪽·엉뚱한 쪽 레퍼런스를 실제 캡처와 함께 내밀어 드려요.</p>
      <div class="examples">${['스킬창 UI/UX 가 별로야, 어떻게 바꿀까?', '인벤토리 화면이 너무 어지러워', '보상 받는 순간이 밋밋해', '강화 결과 연출을 더 맛있게'].map((x) => `<button class="ghost ex">${esc(x)}</button>`).join('')}</div></div>`;
  }
  $('q').focus();
}

// ── 보드 그리기 ──
function shotHTML(b, idx, it) {
  const has = it.shots && it.shots.length && it.shot >= 0;
  const img = has ? `<img src="${esc(it.shots[it.shot])}" alt="">`
    : it.cover ? `<img class="coveronly" src="${esc(it.cover)}" alt="">`
    : `<div class="noshot">캡처 없음<br><small>출처 링크로 확인해 주세요</small></div>`;
  const nav = it.shots && it.shots.length > 1
    ? `<button class="sn" data-b="${b.id}" data-i="${idx}" data-d="-1">‹</button><button class="sn r" data-b="${b.id}" data-i="${idx}" data-d="1">›</button>` : '';
  const tag = `<span class="sk ${it.shotKind || 'none'}">${SHOT_KIND[it.shotKind] || SHOT_KIND.none}${it.shots?.length ? ` · ${it.shot + 1}/${it.shots.length}` : ''}</span>`;
  return `<div class="shot">${img}${nav}${tag}</div>`;
}

function cardHTML(b, it, idx) {
  const links = [
    it.source_url ? `<a href="${esc(it.source_url)}" target="_blank" rel="noopener">출처</a>` : '',
    it.store ? `<a href="${esc(it.store)}" target="_blank" rel="noopener">${({ steam: 'Steam', appstore: '앱스토어', wiki: '위키백과' })[it.source] || '상점'}</a>` : '',
  ].filter(Boolean).join(' · ');
  const isCur = idx === -1;
  return `<div class="rc${isCur ? ' cur' : ''}" data-b="${b.id}" data-i="${idx}">
    ${shotHTML(b, idx, it)}
    <div class="rb">
      <div class="rg">${esc(it.game)}${it.outside_taste ? '<span class="out">취향 밖</span>' : ''}</div>
      <div class="rs">${esc(it.system || '')}</div>
      ${it.caption ? `<div class="rcap">🔎 ${esc(it.caption)}</div>` : ''}
      ${isCur ? `<div class="rt">${esc(it.why || '')}</div>` : `<div class="rt">💡 ${esc(it.take)}</div><div class="ry">${esc(it.why_you)}</div>`}
      <div class="rf"><span class="links">${links}</span>${isCur ? '' : `<span class="votes"><button class="v" data-v="1" title="좋아요">👍</button><button class="v" data-v="-1" title="별로">👎</button></span>`}</div>
    </div></div>`;
}

function boardHTML(b, live) {
  boards.set(b.id, b);
  const items = b.current ? [b.current, ...b.refs] : b.refs;
  const off = b.current ? 1 : 0;
  const groups = ['similar', 'opposite', 'wild'].map((k) => {
    const cards = b.refs.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === k);
    if (!cards.length) return '';
    return `<div class="grp"><h3>${KIND[k].icon} ${KIND[k].name}</h3><div class="cardsrow">${cards.map(({ r, i }) => cardHTML(b, r, i + off)).join('')}</div></div>`;
  }).join('');
  void items;
  const usage = b.via === 'ai'
    ? `AI 호출 2회 · 웹 검색 ${b.usage?.searches || 0}회`
    : b.via === 'claude-code' ? 'Claude Code(/gamebot)에서 만든 보드'
    : b.via === 'mcp' ? `AI 툴(MCP)에서 만든 보드${b.botName ? ` · ${b.botName}` : ''}` : '시험용 가짜 답';
  return `<div class="bot" data-board="${b.id}">
    <p class="reply">${esc(b.reply)}</p>
    ${diagHTML(b)}
    ${propHTML(b)}
    ${b.proposal ? '<h3 class="evid">📚 근거 — 레퍼런스</h3>' : ''}
    ${b.current ? `<div class="grp"><h3>${KIND.current.icon} ${KIND.current.name}</h3><div class="cardsrow one">${cardHTML(b, b.current, -1)}</div></div>` : ''}
    ${groups}
    <div class="askback"><p>${esc(b.ask)}</p>
      ${live ? `<div class="more">${['similar', 'opposite', 'wild'].map((k) => `<button class="ghost mo" data-k="${k}">${KIND[k].icon} ${KIND[k].name.split(' — ')[0]} 더</button>`).join('')}</div>` : ''}
    </div>
    <div class="usage">${usage} · <a href="/?board=${b.id}" target="_blank">이 보드만 열기</a></div>
  </div>`;
}

// 진단: 체감 → 원인
function diagHTML(b) {
  if (!b.diagnosis || !b.diagnosis.length) return '';
  return `<div class="diag"><h3>🩺 진단</h3><ul>${b.diagnosis.map((d) =>
    `<li><b>${esc(d.problem)}</b>${d.cause ? `<span>← ${esc(d.cause)}</span>` : ''}</li>`).join('')}</ul></div>`;
}

// 결론·제안: 결론 한 줄 → 바꿀 것 → 뺀 것 · 다른 방향 · 첫 걸음
function propHTML(b) {
  const p = b.proposal;
  if (!p) return '';
  const sc = { 표시: 'ui', 규칙: 'rule', 콘텐츠: 'new' };
  const steps = p.steps.map((x, i) => `<li><div class="st"><b>${i + 1}. ${esc(x.do)}</b>${x.scope ? `<span class="scope ${sc[x.scope]}">${esc(x.scope)}</span>` : ''}</div>
    ${x.how ? `<div class="how">${esc(x.how)}</div>` : ''}${x.from ? `<div class="pfrom">참고: ${esc(x.from)}</div>` : ''}</li>`).join('');
  return `<div class="prop"><h3>✅ 제안</h3><p class="head">${esc(p.headline)}</p>
    ${steps ? `<ol>${steps}</ol>` : ''}
    <div class="side">
      ${p.first ? `<div><b>첫 걸음</b> ${esc(p.first)}</div>` : ''}
      ${p.alt ? `<div><b>다른 방향</b> ${esc(p.alt.direction)}${p.alt.tradeoff ? ` <span class="dim">— 대가: ${esc(p.alt.tradeoff)}</span>` : ''}</div>` : ''}
      ${p.skip ? `<div><b>이번엔 뺌</b> <span class="dim">${esc(p.skip)}</span></div>` : ''}
    </div></div>`;
}

function itemOf(b, idx) { return idx === -1 ? b.current : b.refs[idx - (b.current ? 1 : 0)]; }

// ── 묻기 ──
async function sendAsk(question, more) {
  if (askState.busy) return;
  question = (question || '').trim();
  if (!question) return;
  askState.busy = true;
  const empty = $('thread').querySelector('.empty'); if (empty) empty.remove();
  const img = askState.image;
  $('thread').insertAdjacentHTML('beforeend', `<div class="me"><div class="bubble">${esc(more ? `${KIND[more].name.split(' — ')[0]} 더 보여줘` : question)}${img ? `<img src="${img}" alt="">` : ''}</div></div>
    <div class="bot pending"><div class="spin"></div><span>${window.AI_ON ? '레퍼런스를 찾고 캡처를 고르는 중… (30초~1분)' : '시험용 답을 만드는 중…'}</span></div>`);
  $('thread').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
  $('q').value = ''; clearAttach();
  try {
    const r = await fetch('/api/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: USER, question, image: img, history: askState.history, more, mock: MOCK }),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || r.status);
    $('thread').querySelector('.bot.pending').outerHTML = boardHTML(b, true);
    askState.history.push({ q: question, games: [b.current?.game, ...b.refs.map((x) => x.game)].filter(Boolean), pick: more || '' });
    askState.lastQ = question;
  } catch (e) {
    $('thread').querySelector('.bot.pending').outerHTML = `<div class="bot err">실패: ${esc(e.message)}</div>`;
  } finally {
    askState.busy = false;
  }
}

// ── 이미지 붙이기 (긴 변 1280px JPEG) ──
function clearAttach() { askState.image = ''; $('attachBox').hidden = true; }
function attachFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1280 / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      askState.image = c.toDataURL('image/jpeg', 0.85);
      $('attachImg').src = askState.image; $('attachBox').hidden = false;
    };
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}

// ── 보드 하나만 (Claude Code /gamebot 이 만든 것) ──
async function showBoardPage(id) {
  showView('boardView');
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.remove('on'));
  $('modeTag').textContent = '보드 보기';
  const r = await fetch(`/api/board?id=${encodeURIComponent(id)}`);
  if (!r.ok) { $('boardOne').innerHTML = '<div class="bot err">보드를 찾지 못했어요.</div>'; return; }
  const b = await r.json();
  $('boardOne').innerHTML = `<div class="me"><div class="bubble">${esc(b.question)}</div></div>${boardHTML(b, false)}`;
}

// ── 연결 ──
$('send').onclick = () => sendAsk($('q').value);
$('q').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendAsk($('q').value); } };
$('q').onpaste = (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); attachFile(f); } };
$('composer').ondragover = (e) => e.preventDefault();
$('composer').ondrop = (e) => { e.preventDefault(); attachFile(e.dataTransfer.files[0]); };
$('file').onchange = (e) => attachFile(e.target.files[0]);
$('attachDel').onclick = clearAttach;

document.addEventListener('click', async (e) => {
  const ex = e.target.closest('.ex');
  if (ex) return sendAsk(ex.textContent);
  const mo = e.target.closest('.mo');
  if (mo) return sendAsk(askState.lastQ || '', mo.dataset.k);
  const sn = e.target.closest('.sn');
  if (sn) {
    const b = boards.get(sn.dataset.b); const idx = Number(sn.dataset.i); const it = itemOf(b, idx);
    it.shot = (it.shot + Number(sn.dataset.d) + it.shots.length) % it.shots.length;
    if (it.shotKind === 'none') it.shotKind = 'gameplay';
    it.caption = '';
    sn.closest('.rc').outerHTML = cardHTML(b, it, idx);
    return;
  }
  const v = e.target.closest('.v');
  if (v) {
    const rc = v.closest('.rc'); const b = boards.get(rc.dataset.b); const it = itemOf(b, Number(rc.dataset.i));
    const vote = rc.dataset.vote === v.dataset.v ? 0 : Number(v.dataset.v);
    rc.dataset.vote = vote || '';
    rc.querySelectorAll('.v').forEach((x) => x.classList.toggle('on', Number(x.dataset.v) === vote));
    await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: USER, game: it.game, system: it.system, kind: it.kind, vote }) });
  }
});
