// 게임 이미지 찾기 — 표지(cover)·인게임 스크린샷(shots)·상점 링크(store).
// 순서: 게임 목록의 Steam id → 앱스토어 id → 위키백과 제목 → (목록 밖이면) Steam 검색 → 앱스토어 검색.
// 이미지는 저장하지 않고 주소만 돌려준다. 키 필요 없음.
const { GAMES } = require('./games.js');

const byName = new Map(GAMES.map((g) => [g.name.toLowerCase(), g]));
const cache = new Map();
const UA = { headers: { 'User-Agent': 'gamebot-local/0.1 (personal tool)' } };
const getJSON = async (url, opt) => { const r = await fetch(url, opt); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const similar = (a, b) => { const x = norm(a), y = norm(b); return x && y && (x.includes(y) || y.includes(x)); };

const steamCover = (id) => `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`;

async function fromSteam(appid) {
  // 지역에 따라 일부 게임 정보를 안 줘서 cc=us 로 묻는다
  const j = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=screenshots&cc=us&l=english`);
  return { cover: steamCover(appid), shots: (j?.[appid]?.data?.screenshots || []).map((s) => s.path_thumbnail), store: `https://store.steampowered.com/app/${appid}/`, source: 'steam' };
}
function appToMedia(a) {
  // 아이폰 스크린샷 우선, 없으면 아이패드
  const shots = (a.screenshotUrls && a.screenshotUrls.length ? a.screenshotUrls : a.ipadScreenshotUrls || []);
  return { cover: a.artworkUrl512 || a.artworkUrl100 || '', shots, store: a.trackViewUrl ? a.trackViewUrl.split('?')[0] : '', source: 'appstore', icon: true };
}
async function fromAppStore(id) {
  const j = await getJSON(`https://itunes.apple.com/lookup?id=${id}&country=kr`);
  const a = (j.results || [])[0];
  return a ? appToMedia(a) : null;
}
async function fromWiki(title, lang = 'en') {
  const j = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, UA);
  const cover = j.originalimage?.source || j.thumbnail?.source || '';
  return cover ? { cover, shots: [], store: j.content_urls?.desktop?.page || '', source: 'wiki' } : null;
}
async function searchSteam(name) {
  const j = await getJSON(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=us`);
  const hit = (j.items || []).find((it) => similar(it.name, name));
  return hit ? hit.id : null;
}
async function searchAppStore(name) {
  // 한국 스토어(한국어 이름) → 미국 스토어(영문 원제) 순서로 찾는다. 예: "Genshin Impact" 는 한국에선 "원신"
  for (const country of ['kr', 'us']) {
    const j = await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&country=${country}&limit=5`);
    const hit = (j.results || []).find((a) => a.primaryGenreName === 'Games' && similar(a.trackName.split(/[:：\-–]/)[0], name.split(/[:：\-–]/)[0]));
    if (hit) return hit;
  }
  return null;
}

async function getMedia(name) {
  const key = String(name).toLowerCase().trim();
  if (cache.has(key)) return cache.get(key);
  const g = byName.get(key) || GAMES.find((x) => norm(x.name) === norm(name));
  let m = null;
  const tries = [];
  if (g?.steam) tries.push(() => fromSteam(g.steam));
  if (g?.ios) tries.push(() => fromAppStore(g.ios));
  if (g?.wiki) tries.push(() => fromWiki(g.wiki));
  if (!g) {
    tries.push(async () => { const id = await searchSteam(name); return id ? { ...(await fromSteam(id)), appid: id } : null; });
    tries.push(async () => { const a = await searchAppStore(name); return a ? appToMedia(a) : null; });
  }
  for (const t of tries) {
    try { m = await t(); } catch { m = null; }
    if (m && (m.shots.length || m.cover)) break;
  }
  m = m || { cover: '', shots: [], store: '', source: 'none' };
  cache.set(key, m);
  return m;
}

module.exports = { getMedia };
