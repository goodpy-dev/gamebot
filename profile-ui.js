// 겜잘알봇 결과지(취향 프로필) · 공유 · 봇 만들기. 스펙: docs/specs/gamebot.md "결과지·공유·봇 만들기"
function toast(id, msg) { const t = $(id); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }

function showProfile(p) {
  window.PROFILE = p;
  showView('profile');
  window.scrollTo(0, 0);
  const ps = p.persona || {};
  $('pMeta').textContent = `${p.user} · ${p.mode === 'ai' ? 'AI 분석' : '규칙 분석'} · ${new Date(p.createdAt).toLocaleDateString('ko-KR')}`;

  // 결과 카드
  $('hEmoji').textContent = ps.emoji || '🎮';
  $('hType').textContent = ps.type_name || p.summary;
  $('hTag').textContent = ps.tagline || '';
  $('hTraits').innerHTML = (ps.traits || []).map((t) => `<div class="trait"><div class="ti">${esc(t.icon)}</div><div><b>${esc(t.label)}</b><span>${esc(t.desc)}</span></div></div>`).join('');
  const topArt = p.art?.styles?.[0];
  $('hMini').innerHTML = [
    ps.soulmates?.[0] ? `<span>💞 찰떡 <b>${esc(ps.soulmates[0].game)}</b></span>` : '',
    topArt ? `<span>👀 최애 화풍 <b>${esc(topArt.style)}</b></span>` : '',
    ps.bot ? `<span>${esc(ps.bot.emoji)} 내 봇 <b>${esc(ps.bot.name)}</b></span>` : '',
  ].filter(Boolean).join('');

  // 취향 레이더: 한마디가 주인공, 근거는 자세히 쪽으로
  $('pAxes').innerHTML = (p.axes || []).map((a, i) => {
    const s = Math.max(0, Math.min(100, a.score));
    const line = ps.axis_lines?.[i] || a.note;
    return `<div class="axis"><span class="l${s < 40 ? ' on' : ''}">${esc(a.left)}</span>
      <div class="track"><div class="dot" style="left:${s}%"></div></div>
      <span class="r${s > 60 ? ' on' : ''}">${esc(a.right)}</span><div class="note fun">${esc(line)}</div></div>`;
  }).join('');
  $('pNotes').innerHTML = (p.axes || []).map((a) => `<li><b>${esc(a.left)}↔${esc(a.right)} ${a.score}</b> — ${esc(a.note)}</li>`).join('');

  const mate = (m, cls) => `<div class="mate ${cls}"><b>${esc(m.game)}</b><span>${esc(m.why)}</span></div>`;
  $('pMates').innerHTML = (ps.soulmates || []).map((m) => mate(m, 'good')).join('') || '<p class="desc small">—</p>';
  $('pNemesis').innerHTML = (ps.nemesis || []).map((m) => mate(m, 'bad')).join('') || '<p class="desc small">—</p>';

  $('pArtSum').textContent = ps.art_eye || p.art?.summary || '아트 조사 없음';
  $('pArt').innerHTML = (p.art?.styles || []).map((a, i) => {
    const s = Math.max(0, Math.min(100, a.score));
    return `<div class="ab${i === 0 ? ' first' : ''}"><span>${esc(a.style)}</span><div class="bt"><div class="bf" style="width:${s}%"></div></div><span class="sc">${s}</span></div>`;
  }).join('');
  $('pArtNotes').innerHTML = (p.art?.styles || []).filter((a) => a.note).map((a) => `<li><b>${esc(a.style)} ${a.score}</b> — ${esc(a.note)}</li>`).join('');

  $('pQuest').textContent = ps.quest_intro || '평소라면 안 고를 것 같지만 볼 만한 방향';
  $('pOutside').innerHTML = (p.outside || []).map((o, i) => `<div class="oc"><div class="qn">퀘스트 ${i + 1}</div><div class="d">${esc(o.direction)}</div>
    <div class="g">${esc((o.games || []).join(' · '))}</div><div class="w">${esc(o.why)}</div></div>`).join('');

  // 자세히
  $('pSummary').textContent = p.summary;
  $('pKeywords').innerHTML = (p.keywords || []).map((k) => `<span class="chip">${esc(k)}</span>`).join('');
  $('pDesc').textContent = p.description;
  $('pMaker').textContent = p.maker || '';
  $('pMakerH').hidden = $('pMaker').hidden = !p.maker;
  $('pOrder').innerHTML = p.likes.map((n, i) => `<span class="pk"><b>${i + 1}</b>${esc(n)}</span>`).join('');
  $('remix').hidden = !window.AI_ON && p.mode === 'ai';
}

// ── 공유 ──
function shareText(p) {
  const ps = p.persona || {};
  return [
    `🎮 겜잘알봇 취향 테스트 결과`,
    `${ps.emoji || ''} 나는 「${ps.type_name || p.summary}」`,
    ps.tagline ? `“${ps.tagline}”` : '',
    '',
    ...(ps.traits || []).map((t) => `${t.icon} ${t.label} — ${t.desc}`),
    '',
    ps.soulmates?.length ? `💞 찰떡: ${ps.soulmates.map((m) => m.game).join(', ')}` : '',
    ps.nemesis?.length ? `⚡ 상극: ${ps.nemesis.map((m) => m.game).join(', ')}` : '',
    ps.art_eye ? `👀 ${ps.art_eye}` : '',
    ps.bot ? `${ps.bot.emoji} 내 봇: ${ps.bot.name} — “${ps.bot.catchphrase}”` : '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
}

$('shareText').onclick = async () => {
  try { await navigator.clipboard.writeText(shareText(window.PROFILE)); toast('toast', '복사했어요 — 메신저에 붙여 넣으세요'); }
  catch { toast('toast', '복사가 막혔어요'); }
};
$('shareImg').onclick = async () => {
  if (typeof html2canvas !== 'function') return toast('toast', '이미지 도구를 못 불러왔어요');
  const el = $('hero');
  el.classList.add('capturing');
  try {
    const canvas = await html2canvas(el, { backgroundColor: null, scale: 2 });
    const a = document.createElement('a');
    a.download = `겜잘알봇-${(window.PROFILE.persona?.type_name || '결과').replace(/\s+/g, '_')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('toast', '결과 카드를 저장했어요');
  } finally { el.classList.remove('capturing'); }
};
$('remix').onclick = async () => {
  if (!confirm(window.AI_ON && !MOCK ? '결과지 문구를 AI 로 다시 쓸까요? (AI 호출 1회)' : '결과지 문구를 규칙으로 다시 쓸까요?')) return;
  $('loadingText').textContent = '문구를 다시 쓰는 중…'; $('loading').hidden = false;
  try {
    const r = await fetch('/api/remix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: USER, mock: MOCK }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    showProfile(d);
  } catch (e) { alert('실패: ' + e.message); } finally { $('loading').hidden = true; }
};
$('makeBot').onclick = () => showBots();

// ── 봇 ──
let myBotId = null;
function fillEditor() {
  const p = window.PROFILE; const b = p?.persona?.bot || {};
  $('beName').value = b.name || ''; $('beEmoji').value = b.emoji || '🤖';
  $('beVoice').value = b.voice || ''; $('beCatch').value = b.catchphrase || '';
  previewBot();
}
function previewBot() {
  $('beAvatar').textContent = $('beEmoji').value || '🤖';
  $('beNameView').textContent = $('beName').value || '이름 없는 봇';
  $('beType').textContent = window.PROFILE?.persona?.type_name ? `「${window.PROFILE.persona.type_name}」 취향 이입` : '';
  $('beSay').textContent = $('beCatch').value || '…';
}
['beName', 'beEmoji', 'beVoice', 'beCatch'].forEach((id) => { $(id).oninput = previewBot; });

function botRow(c) {
  const tag = c.kind === 'api' ? `API · ${esc(c.endpoint)}` : esc(c.profile?.type_name || c.profile?.summary || '');
  return `<div class="botrow" data-id="${c.id}">
    <div class="avatar sm">${esc(c.emoji)}</div>
    <div class="bi"><b>${esc(c.name)}</b>${c.mine ? '<span class="mine">내 봇</span>' : `<span class="from">${esc(c.owner || '받은 봇')}</span>`}
      <div class="bt2">${tag}</div>${c.catchphrase ? `<div class="bq">“${esc(c.catchphrase)}”</div>` : ''}</div>
    <div class="ba">${c.kind === 'persona' ? `<a class="ghost btn" href="/api/bots/export?id=${c.id}">📤 카드 내보내기</a>` : ''}<button class="ghost del" data-id="${c.id}">삭제</button></div>
  </div>`;
}
async function loadBots() {
  const list = await fetch('/api/bots').then((r) => r.json());
  const mine = list.find((c) => c.mine);
  myBotId = mine ? mine.id : null;
  $('beSave').textContent = mine ? '내 봇 고치기' : '내 봇 저장';
  $('botList').innerHTML = list.map(botRow).join('') || '<p class="desc small">아직 봇이 없어요. 위에서 내 봇을 저장하거나 동료의 봇 카드를 불러오세요.</p>';
  return mine;
}
async function showBots() {
  showView('botsView');
  window.scrollTo(0, 0);
  if (!window.PROFILE) {
    const r = await fetch(`/api/profile?user=${encodeURIComponent(USER)}`);
    if (r.ok) window.PROFILE = await r.json();
  }
  $('botEditor').hidden = !window.PROFILE;
  const mine = await loadBots();
  if (mine) {
    $('beName').value = mine.name; $('beEmoji').value = mine.emoji; $('beVoice').value = mine.voice; $('beCatch').value = mine.catchphrase;
    previewBot();
  } else fillEditor();
}
$('beSave').onclick = async () => {
  const edits = { name: $('beName').value.trim(), emoji: $('beEmoji').value.trim(), voice: $('beVoice').value.trim(), catchphrase: $('beCatch').value.trim() };
  if (!edits.name) return toast('beToast', '이름을 적어 주세요');
  const r = await fetch('/api/bots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: USER, fromProfile: true, id: myBotId, edits }) });
  const d = await r.json();
  if (!r.ok) return toast('beToast', d.error);
  await loadBots();
  toast('beToast', '저장했어요 — 목록에서 카드로 내보낼 수 있어요');
};
$('botList').onclick = async (e) => {
  const del = e.target.closest('.del'); if (!del) return;
  if (!confirm('이 봇을 지울까요?')) return;
  await fetch(`/api/bots?id=${del.dataset.id}`, { method: 'DELETE' });
  loadBots();
};
$('botImport').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const card = JSON.parse(await f.text());
    const r = await fetch('/api/bots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    await loadBots();
    alert(`${d.emoji} ${d.name} 을(를) 불러왔어요`);
  } catch (err) { alert('불러오기 실패: ' + err.message); }
  e.target.value = '';
};
