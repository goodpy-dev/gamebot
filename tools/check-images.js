// 게임 목록의 표지·스크린샷이 실제로 뜨는지 전수 조사. 실행: node tools/check-images.js
const { GAMES } = require('../games.js');
const head = async (u) => { try { const r = await fetch(u, { method: 'HEAD' }); return r.ok; } catch { return false; } };
const covers = (id) => [
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
];
(async () => {
  const out = [];
  for (const g of GAMES) {
    if (!g.steam) { out.push({ name: g.name, steam: null }); continue; }
    let cover = -1;
    for (let i = 0; i < 3; i++) if (await head(covers(g.steam)[i])) { cover = i; break; }
    let shots = 0;
    try { const j = await (await fetch(`https://store.steampowered.com/api/appdetails?appids=${g.steam}&filters=screenshots&cc=us&l=english`)).json(); shots = (j[g.steam]?.data?.screenshots || []).length; } catch {}
    out.push({ name: g.name, steam: g.steam, cover, shots });
  }
  const bad = out.filter((o) => o.steam && (o.cover !== 0 || o.shots < 3));
  console.log('Steam 없음:', out.filter((o) => !o.steam).map((o) => o.name).join(', '));
  console.log('Steam 인데 문제:', JSON.stringify(bad));
  console.log('정상:', out.filter((o) => o.steam && o.cover === 0 && o.shots >= 3).length, '/', out.filter((o) => o.steam).length);
})();
