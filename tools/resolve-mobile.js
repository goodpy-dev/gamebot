// 모바일·비Steam 게임의 앱스토어 id·아이콘·스크린샷 수를 찾는다 (애플 공개 검색, 키 없음). 실행: node tools/resolve-mobile.js
const Q = {
  'AFK 아레나': 'AFK Arena', '리니지M': '리니지M', '하스스톤': 'Hearthstone', '마인크래프트': 'Minecraft',
  '원신': 'Genshin Impact', '붕괴: 스타레일': 'Honkai Star Rail', '쿠키런: 킹덤': '쿠키런 킹덤', '서머너즈 워': 'Summoners War',
  '클래시 로얄': 'Clash Royale', '클래시 오브 클랜': 'Clash of Clans', '브롤스타즈': 'Brawl Stars', '승리의 여신: 니케': 'NIKKE',
  '명일방주': '명일방주', '우마무스메 프리티 더비': '우마무스메', 'Fate/Grand Order': 'Fate/Grand Order', '세븐나이츠 키우기': '세븐나이츠 키우기',
  '오딘: 발할라 라이징': '오딘 발할라 라이징', '쿠키런: 오븐브레이크': '쿠키런 오븐브레이크', '포켓몬 GO': 'Pokémon GO', '탕탕특공대': '탕탕특공대',
  '랜덤다이스': '랜덤다이스', '젠레스 존 제로': 'Zenless Zone Zero', '전략적 팀 전투': 'TFT Teamfight Tactics',
};
(async () => {
  for (const [ko, term] of Object.entries(Q)) {
    try {
      const j = await (await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=kr&limit=3`)).json();
      const r = (j.results || []).map((a) => `${a.trackId}:${a.trackName}(${(a.screenshotUrls || []).length}+${(a.ipadScreenshotUrls || []).length})`).join(' | ');
      console.log(`${ko} => ${r}`);
    } catch (e) { console.log(`${ko} => ERR ${e.message}`); }
  }
})();
