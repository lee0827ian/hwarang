// 화랑 FC 사이트 — app.js
// Claude Design "Hwarang Home.dc.html"의 화면 로직을 실제 데이터(Firestore)에 연결한 것.
// 상태나 데이터가 바뀌면 renderVals() → 템플릿 전체를 다시 그린다(#app). 해석기는 renderer.js.
//
// 데이터 (Firestore)
//   hw_team/roster        { members: [{ id, name, pos: 'GK'|'DF'|'MF'|'FW', admin }] }
//   hw_schedules/{id}     { date: 'YYYY-MM-DD', time, venue, address, opponent, lat, lng,
//                           rsvp: { [구성원 id]: 'attend'|'maybe'|'absent' },
//                           guests: { [용병 id]: { name, by: 데려온 구성원 id, at } },
//                           qn: 쿼터 수(4 또는 6, 없으면 4),
//                           quarters: [{ [자리]: 구성원 id 또는 용병 id } × 쿼터 수],
//                           result: { qs: [{ our, their, sc: { [구성원 id | 'merc' | 'og']: 골 } } × 쿼터], our, their, at, by } }

const CFG = window.HWARANG_CONFIG;
const MIN_PLAYERS = 11;                 // 경기 가능 최소 인원
const MOBILE_WIDTH = 760;               // 이 폭 미만이면 모바일 배치(하단 탭)
// 포메이션 4-2-3-1의 자리와 경기장 위 위치(%, 왼쪽·위 기준)
const SLOTS = ['GK', 'LB', 'CB1', 'CB2', 'RB', 'DMF1', 'DMF2', 'LM', 'CM', 'RM', 'ST'];
const XY = { GK: [50, 91], LB: [15, 73], CB1: [37, 78], CB2: [63, 78], RB: [85, 73], DMF1: [31, 60], DMF2: [69, 60], LM: [17, 42], CM: [50, 43], RM: [83, 42], ST: [50, 12] };
const LABEL = { attend: '참석', maybe: '미정', absent: '불참' };
// 상태별 색: [연한 배경, 연한 배경 위 글자, 진한 배경, 진한 배경 위 글자]
const PAL = { attend: ['#FBE9E6', '#A3190B', '#C71F10', '#FFFFFF'], maybe: ['#F6F0DC', '#6E5513', '#D8C07A', '#3D2F08'], absent: ['#F0F0EC', '#4F4F4F', '#6B6B66', '#FFFFFF'] };
const DOW = '일월화수목금토';
const range = n => Array.from({ length: n }, (_, i) => i);
// 경기의 쿼터 수: 저장된 값(qn)이 6이거나 배치가 5쿼터 이상이면 6, 아니면 4
const qnOf = s => (s && (s.qn === 6 || (Array.isArray(s.quarters) && s.quarters.length > 4)) ? 6 : 4);

// ── 카톡 쿼터 기록 읽기 ──
// 한 줄에 한 쿼터: "2쿼터 - 1 : 1 (기현)", 왼쪽=화랑·오른쪽=상대, 괄호=우리 득점자(2골이면 "준원2", 여럿이면 쉼표).
// PC 카톡에서 복사할 때 붙는 "[보낸 사람] [오전 7:58]" 같은 앞부분은 무시한다.
// "용병·지인·지인분"=용병 골, "자책골·OG"=상대 자책골, "미상"=득점자 모름. 점수는 "4 : 0"과 "4대0" 둘 다, 이름은 쉼표나 띄어쓰기로 구분.
// "현재"가 들어간 줄(경기 중 중간 보고)은 건너뛴다.
// 쿼터별 점수가 없으면 합계 한 줄도 받는다: "2 : 8 (우인, 진호)", "1,2,3,4쿼터 2:8 (우인, 진호)" → total
function parseQuarterLog(text, members) {
  const qs = [], errors = [], warnings = [];
  let total = null;
  const given = n => (n.length === 3 ? n.slice(1) : n);
  const resolve = raw => {
    const n = raw.replace(/\s+/g, '');
    if (/^(용병|지인|지인분|게스트)$/.test(n)) return { key: 'merc', name: '용병' };
    if (/^(상대)?(자책|자책골|자살골)$/i.test(n) || /^og$/i.test(n)) return { key: 'og', name: '자책골' };
    if (/^(미상|모름|\?)$/.test(n)) return { key: 'unk', name: '미상' };
    let hit = members.filter(m => m.name.replace(/\s+/g, '') === n);
    if (!hit.length) hit = members.filter(m => given(m.name.replace(/\s+/g, '')) === n);
    if (hit.length === 1) return { key: String(hit[0].id), name: hit[0].name };
    return { error: hit.length ? '"' + raw + '" 같은 이름이 ' + hit.length + '명(' + hit.map(m => m.name).join('/') + ') — 성까지 적어 주세요' : '"' + raw + '" 명단에서 못 찾음 — 이름을 확인해 주세요' };
  };
  const scorers = (str, label) => {
    const sc = {}, names = [];
    const one = tok => {
      const t = /^(\D+?)\s*(\d+)?\s*(골)?$/.exec(tok);
      const r = t ? resolve(t[1]) : { error: '"' + tok + '" — 읽지 못함' };
      return r.error ? r : { ...r, n: Number(t[2] || 1) };
    };
    for (const tok of (str || '').split(/[,，、\/]/).map(t => t.trim()).filter(Boolean)) {
      let parts = [one(tok)];
      // "동민 도현 경호2"처럼 띄어쓰기로만 나눈 경우
      if (parts[0].error && /\s/.test(tok)) {
        const split = tok.split(/\s+/).map(one);
        if (split.every(x => !x.error)) parts = split;
      }
      for (const r of parts) {
        if (r.error) { errors.push(label + ' ' + r.error); continue; }
        sc[r.key] = (sc[r.key] || 0) + r.n;
        names.push(r.name + (r.n > 1 ? ' ' + r.n : ''));
      }
    }
    return { sc, names };
  };
  const sumOf = sc => Object.values(sc).reduce((x, y) => x + y, 0);
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\s*(\[[^\]]*\]\s*)+/, '');   // PC 카톡 "[보낸 사람] [오전 7:58]"
    // 합계 줄 다음 줄에 괄호만 따로 쓴 득점자: "3:6" ↵ "(지윤,우인,기현)"
    const only = /^\s*\(([^)]*)\)\s*$/.exec(line);
    if (only && total && !total.names.length) {
      const before = errors.length, { sc, names } = scorers(only[1], '합계');
      Object.assign(total, { sc, names });
      const wi = warnings.indexOf('득점자 0골 ≠ 화랑 점수 ' + total.our);   // 합계 줄에서 낸 경고는 거둬들임
      if (wi >= 0) warnings.splice(wi, 1);
      if (errors.length === before && sumOf(sc) !== total.our) warnings.push('득점자 ' + sumOf(sc) + '골 ≠ 화랑 점수 ' + total.our);
      continue;
    }
    if (/현재/.test(line)) continue;
    const multi = /(\d+(?:\s*[,，]\s*\d+)+)\s*쿼터\s*[-–—:]?\s*(\d+)\s*(?:[:：]|대)\s*(\d+)\s*(?:\(([^)]*)\))?/.exec(line);
    const m = !multi && /(\d+)\s*쿼터\s*[-–—:]?\s*(\d+)\s*(?:[:：]|대)\s*(\d+)\s*(?:\(([^)]*)\))?/.exec(line);
    const tot = multi || (!m && !/쿼터/.test(line) && /(\d+)\s*(?:[:：]|대)\s*(\d+)\s*(?:\(([^)]*)\))?/.exec(line));
    if (m) {
      const q = Number(m[1]), our = Number(m[2]), their = Number(m[3]);
      if (q < 1 || q > 8) { errors.push(line.trim() + ' — 쿼터 번호 확인'); continue; }
      const before = errors.length, { sc, names } = scorers(m[4], q + '쿼터');
      if (errors.length === before && sumOf(sc) !== our) warnings.push(q + '쿼터 득점자 ' + sumOf(sc) + '골 ≠ 화랑 점수 ' + our);
      if (qs[q - 1]) warnings.push(q + '쿼터가 두 번 있어요(뒤에 것을 씀)');
      qs[q - 1] = { our, their, sc, names };
    } else if (tot) {
      const g = multi ? [null, multi[2], multi[3], multi[4]] : tot;
      const our = Number(g[1]), their = Number(g[2]);
      const before = errors.length, { sc, names } = scorers(g[3], '합계');
      if (errors.length === before && sumOf(sc) !== our) warnings.push('득점자 ' + sumOf(sc) + '골 ≠ 화랑 점수 ' + our);
      if (total) warnings.push('합계 줄이 두 번 있어요(뒤에 것을 씀)');
      total = { our, their, sc, names, qn: multi ? multi[1].split(/[,，]/).length : null };
    }
  }
  const n = qs.length;
  for (let i = 0; i < n; i++) if (!qs[i]) errors.push((i + 1) + '쿼터 기록이 없어요');
  if (n && total) { warnings.push('쿼터별 기록이 있어서 합계 줄은 쓰지 않아요'); total = null; }
  if (!n && !total) errors.push('"1쿼터 - 0 : 1" 또는 "2 : 8 (득점자)" 같은 줄을 찾지 못했어요');
  return { qs, total, errors, warnings };
}
// 경기 결과(쿼터별 또는 합계만) — 없으면 null
const resultOf = s => (s && s.result && Number.isFinite(s.result.our) && Number.isFinite(s.result.their) ? s.result : null);
// 득점자 합계 { 구성원 id | 'merc' | 'og': 골 }
function scorersOf(r) {
  const t = {};
  (Array.isArray(r.qs) && r.qs.length ? r.qs.map(q => q.sc || {}) : [r.sc || {}])
    .forEach(sc => Object.entries(sc).forEach(([k, n]) => { t[k] = (t[k] || 0) + n; }));
  return t;
}
// 유튜브 경기 영상 링크: 영상 하나(watch·youtu.be·shorts·live) 또는 재생목록을 받아 깔끔한 주소로 바꾼다. 유튜브가 아니면 null, 빈칸이면 ''
function ytUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch (e) { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const id = x => (x && /^[\w-]{6,}$/.test(x) ? x : null);
  const list = id(u.searchParams.get('list'));
  let v = null;
  if (host === 'youtu.be') v = id(u.pathname.slice(1).split('/')[0]);
  else if (host === 'youtube.com') {
    const m = /^\/(shorts|live|embed)\/([\w-]+)/.exec(u.pathname);
    v = m ? id(m[2]) : id(u.searchParams.get('v'));
  } else return null;
  if (v) return 'https://www.youtube.com/watch?v=' + v + (list ? '&list=' + list : '');
  if (list) return 'https://www.youtube.com/playlist?list=' + list;
  return null;
}
// 유튜브 주소에서 영상 id / 재생목록 id
function ytParts(url) {
  const u = ytUrl(url);
  if (!u) return null;
  const q = new URL(u).searchParams;
  return { v: q.get('v'), list: q.get('list') };
}
// 영상 장면 표: 유튜브 링크가 있는 줄이 영상 하나(링크 앞 글자가 이름, 예 "1쿼터 https://youtu.be/..."),
// 그 아래 "1:30 쿼터시작" · "20:13 ~ 20:44 트래킹 오류" 같은 줄이 그 영상의 장면. 유튜브 설명란을 그대로 붙여 넣어도 된다.
function parseClips(text) {
  const clips = [], errors = [];
  const sec = t => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const link = /(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+/i.exec(line);
    if (link) {
      const yp = ytParts(link[0]);
      if (!yp || !yp.v) { errors.push('영상 장면: "' + link[0] + '" — 영상 하나짜리 유튜브 링크가 아니에요'); continue; }
      const label = line.replace(link[0], '').replace(/[\s:：\-–—]+$/, '').trim();
      clips.push({ v: yp.v, label: label || (clips.length + 1) + '번 영상', marks: [] });
      continue;
    }
    const m = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(?:~\s*((?:\d{1,2}:)?\d{1,2}:\d{2}))?\s*(.*)$/.exec(line);
    if (!m) continue;   // 설명란의 제목 줄 같은 것은 건너뛴다
    if (!clips.length) { errors.push('영상 장면: 시간 줄 위에 유튜브 영상 링크 줄이 있어야 해요'); break; }
    const mk = { t: sec(m[1]), l: m[3].trim() };
    if (m[2]) mk.e = sec(m[2]);
    clips[clips.length - 1].marks.push(mk);
  }
  return { clips, errors };
}
const fmtSec = n => { const h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60, x = String(n % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; };
function clipsText(clips) {
  return (clips || []).map(c => [c.label + ' https://youtu.be/' + c.v].concat((c.marks || []).map(k => fmtSec(k.t) + (k.e != null ? ' ~ ' + fmtSec(k.e) : '') + ' ' + k.l)).join('\n')).join('\n\n');
}
// 장면 종류: 설명 문구로 나눈다(득점·실점·위기·찬스·기타). 타임라인 점 색과 목록 배지에 쓴다.
const KINDS = {
  goal: { name: '득점', c: '#D92D20', z: 5, sz: 18 }, lost: { name: '실점', c: '#141414', z: 4, sz: 18 },
  risk: { name: '위기', c: '#E8890C', z: 3, sz: 14 }, chance: { name: '찬스', c: '#1A66D2', z: 2, sz: 14 }, etc: { name: '기타', c: '#B5B4AE', z: 1, sz: 10 }
};
function markKind(l) {
  const s = String(l || '');
  if (/득점/.test(s) && !/실패|무산|찬스/.test(s)) return 'goal';
  if (/실점/.test(s) && !/위기/.test(s)) return 'lost';
  if (/허용|위기|슈퍼세이브/.test(s)) return 'risk';
  if (/슈팅|찬스|시퀀스|PK|역습|크로스|침투|헤더|코너|프리킥|오버래핑/i.test(s)) return 'chance';
  return 'etc';
}
window.markKind = markKind;
window.parseQuarterLog = parseQuarterLog;
window.parseClips = parseClips;
window.ytUrl = ytUrl;

// 기기 시간대 기준 오늘 날짜(YYYY-MM-DD)
const localDate = () => { const n = new Date(); return new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// 경기 당일 오전 7시가 되면 그날 경기는 지난 일정으로 넘기고 다음 경기를 보여 준다.
// 이 날짜보다 앞선 일정 = 지난 일정(7시 전이면 오늘, 7시부터는 내일)
const SWITCH_HOUR = 7;
const cutDate = () => { const n = new Date(); if (n.getHours() >= SWITCH_HOUR) n.setDate(n.getDate() + 1); return new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const posName = slot => slot.replace(/\d/g, '');
const el = id => document.getElementById(id);

// ── 카카오 지도 SDK(구장 지도, 주소 → 좌표) ──
let kakaoMapsReady = null;
function loadKakaoMaps() {
  if (kakaoMapsReady) return kakaoMapsReady;
  kakaoMapsReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CFG.kakaoMapKey}&autoload=false&libraries=services`;
    s.onload = () => window.kakao.maps.load(resolve);
    s.onerror = () => { kakaoMapsReady = null; reject(new Error('kakao maps sdk load failed')); };
    document.head.appendChild(s);
  });
  return kakaoMapsReady;
}
// 주소로 좌표를 찾고, 안 되면 구장 이름으로 찾는다. 못 찾으면 null.
function geocode(address, name) {
  return loadKakaoMaps().then(() => new Promise(resolve => {
    const sv = window.kakao.maps.services;
    const ok = (result, status) => status === sv.Status.OK && result.length > 0;
    const done = result => resolve({ lat: Number(result[0].y), lng: Number(result[0].x) });
    const byName = () => {
      if (!name) { resolve(null); return; }
      new sv.Places().keywordSearch(name, (result, status) => { if (ok(result, status)) done(result); else resolve(null); });
    };
    if (!address) { byName(); return; }
    new sv.Geocoder().addressSearch(address, (result, status) => { if (ok(result, status)) done(result); else byName(); });
  })).catch(() => null);
}

// ── 카카오 JS SDK(카카오내비 실행, 카톡 공유). 지도 SDK와 별개(window.Kakao)이고 키도 다르다(config.js 참고) ──
let kakaoSdkReady = null;
function loadKakaoSdk() {
  if (kakaoSdkReady) return kakaoSdkReady;
  kakaoSdkReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.3/kakao.min.js';
    s.integrity = 'sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy';
    s.crossOrigin = 'anonymous';
    s.onload = () => { if (!window.Kakao.isInitialized()) window.Kakao.init(CFG.kakaoAppKey); resolve(); };
    s.onerror = () => { kakaoSdkReady = null; reject(new Error('kakao js sdk load failed')); };
    document.head.appendChild(s);
  });
  return kakaoSdkReady;
}
function startKakaoNavi(name, lat, lng) {
  const go = () => window.Kakao.Navi.start({ name, x: lng, y: lat, coordType: 'wgs84' });
  if (window.Kakao && window.Kakao.Navi && window.Kakao.isInitialized()) go();
  else loadKakaoSdk().then(go).catch(() => {});
}

// ── 내비 연결 버튼 ──
// 휴대폰 + 좌표 있음: T맵 · 카카오내비 · 네이버지도. 안드로이드는 intent 주소라 앱이 없으면 스토어로 가고,
// 아이폰은 앱 주소를 연 뒤 1.5초가 지나도 화면이 그대로면 스토어로 보낸다.
// 그 밖(PC, 좌표 없음): 카카오맵 웹 링크 하나.
function navLinks(s) {
  const name = s.venue || '';
  const hasCoord = typeof s.lat === 'number' && typeof s.lng === 'number';
  const n = encodeURIComponent(name);
  const android = /Android/i.test(navigator.userAgent), ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!hasCoord || (!android && !ios)) {
    const where = s.address || (name === '미정' ? '' : name);   // 구장이 정해지지 않았으면 버튼을 주지 않는다
    if (!where) return [];
    const href = hasCoord ? `https://map.kakao.com/link/to/${n},${s.lat},${s.lng}` : 'https://map.kakao.com/link/search/' + encodeURIComponent(where);
    return [{ label: '카카오맵에서 보기', href, target: '_blank' }];
  }
  const storeLater = store => () => { setTimeout(() => { if (!document.hidden) location.href = store; }, 1500); };
  const tmap = `route?goalname=${n}&goalx=${s.lng}&goaly=${s.lat}`;
  const nmap = `route/car?dlat=${s.lat}&dlng=${s.lng}&dname=${n}&appname=${encodeURIComponent(location.host)}`;
  return [
    android
      ? { label: 'T맵', target: '', href: `intent://${tmap}#Intent;scheme=tmap;package=com.skt.tmap.ku;end` }
      : { label: 'T맵', target: '', href: `tmap://${tmap}`, onClick: storeLater('https://apps.apple.com/kr/app/id431589174') },
    { label: '카카오내비', target: '', href: '#', onClick: e => { e.preventDefault(); startKakaoNavi(name, s.lat, s.lng); } },
    android
      ? { label: '네이버지도', target: '', href: `intent://${nmap}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end` }
      : { label: '네이버지도', target: '', href: `nmap://${nmap}`, onClick: storeLater('http://itunes.apple.com/app/id311867728?mt=8') }
  ];
}
const navCols = apps => `repeat(${apps.length || 1}, minmax(0,1fr))`;

// 검색 칸: 다시 그리지 않고 보이는 항목만 걸러낸다(다시 그리면 입력 칸이 포커스를 잃는다)
function filterByQuery(selector, attr, query, emptyId, display) {
  const q = query.replace(/\s/g, '');
  let shown = 0;
  document.querySelectorAll(selector).forEach(node => {
    const hit = !q || node.dataset[attr].includes(q);
    node.style.display = hit ? display : 'none';
    if (hit) shown++;
  });
  const empty = el(emptyId);
  if (empty) empty.dataset.show = String(!shown);
}

class HwarangApp {
  constructor() {
    this.members = null;      // null = 아직 못 읽음
    this.schedules = null;
    this.loadError = '';
    this.memberQuery = '';
    let me = null;
    try { me = Number(localStorage.getItem('hwarang_me')) || null; } catch (e) {}
    // 카톡 공유 카드의 참석 · 미정 · 불참을 눌러 들어온 경우(?s=일정 id&r=응답). 데이터를 읽은 뒤 한 번만 반영하고,
    // 새로고침해도 다시 반영되지 않도록 주소에서는 바로 지운다.
    const qs = new URLSearchParams(location.search);
    this.pendingRsvp = qs.get('s') && LABEL[qs.get('r')] ? { id: qs.get('s'), status: qs.get('r') } : null;
    if (qs.has('s') || qs.has('r')) history.replaceState(null, '', location.pathname);
    this.state = {
      tab: 'home', me, q: 0, flash: '',
      pickerOpen: false, rsvpEditing: false, mapOpen: false, rosterOpen: null,
      guestForm: null,
      draft: null, draftFor: null, sel: null, dirty: false, savedAt: 0, fmError: '',
      schedView: 'upcoming', schedSel: undefined, schedForm: null, resultForm: null,
      memberPos: 'all', memberForm: null,
      recYear: null, recOpen: null, recAllAtt: false, recAllGoals: false,
      vidOpen: null, vidSel: {}, vidKind: {}, vidList: {}, vidAn: {},
      isMobile: window.innerWidth < MOBILE_WIDTH
    };
  }

  // ── 상태 · 그리기 ──
  setState(update) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    if (!patch) return;
    const next = { ...this.state, ...patch };
    let changed = false;
    for (const k of new Set([...Object.keys(this.state), ...Object.keys(next)])) if (this.state[k] !== next[k]) { changed = true; break; }
    if (!changed) return;
    this.state = next;
    this.render();
  }
  mount(rootEl, templateEl) {
    this.root = rootEl;
    this.template = templateEl.content;
    this.render();
    window.addEventListener('resize', () => { const m = window.innerWidth < MOBILE_WIDTH; if (m !== this.state.isMobile) this.setState({ isMobile: m }); });
    this.connect();
    // 공유 버튼이 보이는 주소에서는 카카오 SDK를 미리 불러 둔다(누른 즉시 실행되게)
    if ((CFG.kakaoShareHosts || []).includes(location.hostname)) loadKakaoSdk().catch(() => {});
  }
  render() {
    if (this._rendering) { this._dirty = true; return; }
    this._rendering = true;
    try {
      const frag = document.createDocumentFragment();
      renderNodes(frag, this.template.childNodes, this.renderVals());
      this.root.replaceChildren(frag);
      this.afterRender();
    } finally {
      this._rendering = false;
    }
    if (this._dirty) { this._dirty = false; this.render(); }
  }

  // ── 데이터: Firestore 실시간 구독 ──
  connect() {
    try {
      firebase.initializeApp(CFG.firebase);
      this.db = firebase.firestore();
      this.db.collection('hw_team').doc('roster').onSnapshot(doc => {
        this.members = ((doc.data() || {}).members || []).slice();
        this.dataChanged();
      }, () => this.fail());
      this.db.collection('hw_schedules').onSnapshot(snap => {
        this.schedules = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.date)
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        this.dataChanged();
      }, () => this.fail());
      // 화면을 켜 둔 채 7시를 넘겨도 다음 경기로 바뀌게 1분마다 확인
      setInterval(() => this.setState({ cut: cutDate() }), 60000);
    } catch (e) { this.fail(); }
  }
  fail() { this.loadError = '데이터를 불러오지 못했어요. 잠시 후 새로고침해 주세요.'; this.render(); }
  // 글자를 입력하는 창이 열려 있을 때는 다시 그리지 않는다(입력 중인 글이 지워지므로). 창을 닫으면 최신 데이터로 그려진다.
  dataChanged() {
    this.applyPendingRsvp();
    if (this.state.pickerOpen || this.state.schedForm || this.state.memberForm || this.state.guestForm || this.state.resultForm) return;
    this.render();
  }

  // ── 카톡 공유 카드 ──
  // 화면 위쪽 안내 한 줄. 6초 뒤 사라진다
  flash(text) {
    clearTimeout(this._flashTimer);
    this.setState({ flash: text });
    this._flashTimer = setTimeout(() => this.setState({ flash: '' }), 6000);
  }
  pendingLabel() {
    const p = this.pendingRsvp, s = p && (this.schedules || []).find(x => x.id === p.id);
    if (!s) return '';
    const d = new Date(s.date + 'T00:00:00');
    return (d.getMonth() + 1) + '.' + d.getDate() + ' 경기';
  }
  // 카드에서 누른 응답을 저장한다. 이름을 아직 안 골랐으면 이름 선택 창을 열고, 고른 뒤에 다시 불린다.
  applyPendingRsvp() {
    const p = this.pendingRsvp;
    if (!p || this.members === null || this.schedules === null) return;
    const s = this.schedules.find(x => x.id === p.id), when = this.pendingLabel();
    if (!s || s.date < cutDate()) {
      this.pendingRsvp = null;
      this.flash(s ? when + '는 이미 지나서 응답을 바꿀 수 없어요.' : '찾을 수 없는 일정이에요.');
      return;
    }
    if (!this.members.some(m => m.id === this.state.me)) { this.setState({ tab: 'home', pickerOpen: true }); return; }
    this.pendingRsvp = null;
    this.setRsvp(s.id, p.status);
    this.setState({ tab: 'home', rsvpEditing: false });
    this.flash(when + ' "' + LABEL[p.status] + '"으로 저장했어요.');
  }
  // 단체방에 올릴 카드: 참석 · 미정 · 불참 항목마다 응답이 담긴 주소를 건다
  shareToKakao(s) {
    const d = new Date(s.date + 'T00:00:00');
    const base = location.origin + location.pathname;
    const link = query => ({ mobileWebUrl: base + query, webUrl: base + query });
    const title = (d.getMonth() + 1) + '.' + d.getDate() + ' (' + DOW[d.getDay()] + ')' + (s.time ? ' ' + s.time : '') + ' · ' + (s.venue || '구장 미정');
    const send = () => {
      window.Kakao.Share.sendDefault({
        objectType: 'list',
        headerTitle: title,
        headerLink: link(''),
        contents: ['attend', 'maybe', 'absent'].map(k => ({
          title: LABEL[k], description: '눌러서 응답하기',
          link: link('?s=' + encodeURIComponent(s.id) + '&r=' + k)
        })),
        buttons: [{ title: '참석 현황 보기', link: link('') }]
      });
      // 눌렀는데 아무 일도 없어 보이지 않게 안내를 남긴다. PC는 새 창으로 열리는데 브라우저가 팝업을 막으면 창이 안 뜬다
      this.flash(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? '카카오톡을 여는 중이에요.'
        : '카카오톡 공유 창을 열었어요. 창이 안 보이면 주소창 끝의 팝업 차단 표시를 눌러 허용해 주세요.');
    };
    const fail = () => alert('카카오톡 공유를 열지 못했어요. 잠시 후 다시 눌러 주세요.');
    // SDK를 미리 불러 둔 경우에는 누른 그 자리에서 바로 실행한다(늦게 실행하면 브라우저가 새 창을 막을 수 있다)
    if (window.Kakao && window.Kakao.Share && window.Kakao.isInitialized()) { try { send(); } catch (e) { fail(); } }
    else loadKakaoSdk().then(send).catch(fail);
  }

  // ── 쓰기 ──
  setRsvp(scheduleId, status) {
    const me = this.state.me;
    if (!me) return;
    this.db.collection('hw_schedules').doc(scheduleId).update({ ['rsvp.' + me]: status, updatedAt: Date.now() })
      .catch(() => alert('저장하지 못했어요. 잠시 후 다시 눌러 주세요.'));
  }
  // 용병: 이름을 고른 사람이면 누구나 넣는다. 빼는 버튼은 데려온 사람과 운영진에게만 보인다.
  addGuest(s) {
    const name = el('gf-name').value.trim().replace(/\s+/g, ' ');
    const fail = error => this.setState({ guestForm: { name, error } });
    if (!name) return fail('용병 이름을 넣어 주세요.');
    if (this.members.some(m => m.name === name)) return fail('명단에 있는 이름이에요. 본인이 직접 참석을 눌러 주세요.');
    if (Object.values(s.guests || {}).some(x => x.name === name)) return fail('같은 이름의 용병이 이미 있어요.');
    const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.db.collection('hw_schedules').doc(s.id).update({ ['guests.' + id]: { name, by: this.state.me, at: Date.now() }, updatedAt: Date.now() })
      .then(() => this.setState({ guestForm: null, rosterOpen: true }))
      .catch(() => fail('저장하지 못했어요. 잠시 후 다시 눌러 주세요.'));
  }
  removeGuest(s, id) {
    const patch = { ['guests.' + id]: firebase.firestore.FieldValue.delete(), updatedAt: Date.now() };
    // 포메이션에 들어가 있었으면 그 자리도 비운다
    if (Array.isArray(s.quarters) && s.quarters.some(q => Object.values(q || {}).includes(id))) {
      patch.quarters = s.quarters.map(q => Object.fromEntries(Object.entries(q || {}).filter(([, v]) => v !== id)));
    }
    this.db.collection('hw_schedules').doc(s.id).update(patch).catch(() => alert('빼지 못했어요. 잠시 후 다시 눌러 주세요.'));
  }
  // 문서의 쿼터 배치 → 편집용 [[자리, 구성원 id 또는 null] × 11] × 쿼터 수. 저장된 것이 없으면 null
  quartersOf(s) {
    const q = s && s.quarters;
    if (!Array.isArray(q) || !q.length) return null;
    return range(qnOf(s)).map(i => SLOTS.map(slot => [slot, q[i] && q[i][slot] != null ? q[i][slot] : null]));
  }
  // 카톡 쿼터 기록: 읽어서 미리 보여 주거나(save=false) 저장한다
  submitResult(save) {
    const f = this.state.resultForm;
    const text = el('rf-text') ? el('rf-text').value : f.text;
    const videoRaw = el('rf-video') ? el('rf-video').value : (f.video || '');
    const video = ytUrl(videoRaw);
    const p = parseQuarterLog(text, this.members || []);
    if (video === null) p.errors.push('영상 링크가 유튜브 주소가 아니에요 — 영상이나 재생목록 링크를 넣어 주세요');
    const clipsRaw = el('rf-clips') ? el('rf-clips').value : (f.clips || '');
    const pc = parseClips(clipsRaw);
    p.errors.push(...pc.errors);
    const T = p.total;
    const preview = T ? ['쿼터별 점수 없이 합계만' + (T.qn ? ' (' + T.qn + '쿼터)' : '') + (T.names.length ? '  (' + T.names.join(', ') + ')' : '')]
      : p.qs.map((q, i) => (i + 1) + '쿼터  ' + q.our + ' : ' + q.their + (q.names.length ? '  (' + q.names.join(', ') + ')' : ''));
    const our = T ? T.our : p.qs.reduce((x, q) => x + q.our, 0), their = T ? T.their : p.qs.reduce((x, q) => x + q.their, 0);
    const next = { ...f, text, video: videoRaw, clips: clipsRaw, preview, errors: p.errors, warnings: p.warnings, total: (p.qs.length || T) ? '합계 ' + our + ' : ' + their + ' (' + (our > their ? '승' : our < their ? '패' : '무') + ')' : '', checked: true };
    if (!save || p.errors.length) { this.setState({ resultForm: { ...next, error: save && p.errors.length ? '빨간 줄을 고친 뒤 다시 저장해 주세요.' : '' } }); return; }
    this.setState({ resultForm: { ...next, saving: true, error: '' } });
    const result = T ? { qs: [], sc: T.sc, qn: T.qn, our, their, at: Date.now(), by: this.state.me || null }
      : { qs: p.qs.map(q => ({ our: q.our, their: q.their, sc: q.sc })), our, their, at: Date.now(), by: this.state.me || null };
    if (video) result.video = video;
    if (pc.clips.length) {
      // 장면 표에는 영상 길이·분석 데이터가 없으니, 같은 영상의 기존 길이(d)와 분석(an)을 이어 붙인다
      const old = (((this.schedules || []).find(x => x.id === f.id) || {}).result || {}).clips || [];
      result.clips = pc.clips.map(c => { const o = old.find(x => x && x.v === c.v) || {}; const keep = {}; if (o.d) keep.d = o.d; if (o.an) keep.an = o.an; return { ...c, ...keep }; });
    }
    this.db.collection('hw_schedules').doc(f.id).update({ result, updatedAt: Date.now() })
      .then(() => this.setState({ resultForm: null, schedSel: f.id }))
      .catch(() => this.setState({ resultForm: { ...next, saving: false, error: '저장하지 못했어요. 잠시 후 다시 눌러 주세요.' } }));
  }
  saveSchedule() {
    const f = this.state.schedForm;
    const v = id => el(id).value.trim();
    const data = { date: v('sf-date'), time: v('sf-time'), venue: v('sf-venue'), address: v('sf-address'), opponent: v('sf-opp') };
    if (!data.date || !data.venue) { this.setState({ schedForm: { ...f, ...data, error: '날짜와 구장 이름은 꼭 넣어 주세요.' } }); return; }
    this.setState({ schedForm: { ...f, ...data, error: '', saving: true } });
    const ref = f.id ? this.db.collection('hw_schedules').doc(f.id) : this.db.collection('hw_schedules').doc();
    // 지도와 내비 연결에 쓸 좌표를 찾아 같이 저장한다. 못 찾아도 일정은 저장한다.
    geocode(data.address, data.venue).then(coord => {
      const doc = { ...data, lat: coord ? coord.lat : null, lng: coord ? coord.lng : null, updatedAt: Date.now() };
      return f.id ? ref.update(doc) : ref.set({ ...doc, rsvp: {}, quarters: [] });
    }).then(() => this.setState({ schedForm: null, schedSel: ref.id, schedView: data.date >= cutDate() ? 'upcoming' : 'past' }))
      .catch(() => this.setState({ schedForm: { ...f, ...data, saving: false, error: '저장하지 못했어요. 잠시 후 다시 눌러 주세요.' } }));
  }
  saveMember() {
    const f = this.state.memberForm;
    const name = el('mf-name').value.trim(), pos = el('mf-pos').value, admin = el('mf-role').value === 'admin';
    const fail = error => this.setState({ memberForm: { ...f, name, pos, role: admin ? 'admin' : 'member', error } });
    if (!name) return fail('이름을 넣어 주세요.');
    if (this.members.some(m => m.name === name && m.id !== f.id)) return fail('같은 이름이 이미 있어요.');
    const members = f.id
      ? this.members.map(m => (m.id === f.id ? { ...m, name, pos, admin } : m))
      : this.members.concat([{ id: this.members.reduce((mx, m) => Math.max(mx, m.id), 0) + 1, name, pos, admin }]);
    this.writeRoster(members, fail);
  }
  // 구성원 탭 포지션 칸에서 바로 바꾼다(누구나)
  setPos(id, pos) {
    const cur = this.members.find(m => m.id === id);
    if (!cur || cur.pos === pos) return;
    this.writeRoster(this.members.map(m => (m.id === id ? { ...m, pos } : m)), () => alert('포지션을 바꾸지 못했어요. 잠시 후 다시 해 주세요.'));
  }
  writeRoster(members, fail) {
    this.db.collection('hw_team').doc('roster').set({ members, updatedAt: Date.now() })
      .then(() => this.setState({ memberForm: null }))
      .catch(() => fail('저장하지 못했어요. 잠시 후 다시 눌러 주세요.'));
  }

  // ── 지도 ──
  // 화면을 다시 그릴 때마다 #venueMap 자리가 새로 생기므로 지도 본체(this._mapEl)는 한 번만 만들고 옮겨 붙인다.
  afterRender() {
    this.placePlayer();
    this.mapAfterRender();
  }
  // 유튜브 플레이어는 화면을 다시 그릴 때마다 새로 불러오지 않도록 body에 따로 두고, 템플릿의 자리(data-yt-slot) 위에 겹쳐 놓는다.
  placePlayer() {
    const slot = document.querySelector('[data-yt-slot]');
    if (!this._yt) {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute; z-index:50; display:none; border-radius:12px; overflow:hidden; background:#000;';
      const fr = document.createElement('iframe');
      fr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      fr.setAttribute('allowfullscreen', '');
      fr.style.cssText = 'width:100%; height:100%; border:0; display:block;';
      host.appendChild(fr);
      // 분석 박스(재생 위치에 맞춰 바뀜). 누를 일이 없으니 영상 조작을 막지 않게 pointer-events 끔
      const ov = document.createElement('div');
      ov.style.cssText = 'position:absolute; left:3%; top:4%; width:21em; background:rgba(10,10,10,.62); border-radius:.8em; padding:.75em .9em; color:#fff; display:none; flex-direction:column; gap:.4em; pointer-events:none; line-height:1.3;';
      ov.innerHTML = '<div data-a="fold" title="접기" style="font-weight:800; display:flex; align-items:center; gap:.45em; cursor:pointer; pointer-events:auto; margin:-.3em -.3em 0; padding:.3em;"><span style="display:block; width:.8em; height:.8em; border-radius:50%; background:#C71F10; box-shadow:0 0 0 2px rgba(255,255,255,.85);"></span>경기 흐름 · 최근 1분</div>'
        + '<div style="position:relative; height:.65em; border-radius:.33em; margin-top:.55em; background:linear-gradient(90deg,#8E8D88 0 50%,#C71F10 50% 100%);"><div style="position:absolute; left:50%; top:-.25em; bottom:-.25em; width:2px; background:rgba(255,255,255,.7);"></div><div data-a="nd" style="position:absolute; top:-.6em; width:0; height:0; margin-left:-.5em; border-left:.5em solid transparent; border-right:.5em solid transparent; border-top:.65em solid #fff; transition:left .3s linear;"></div></div>'
        + '<div style="display:flex; justify-content:space-between; font-size:.88em; opacity:.8;"><span>우리 진영 쪽</span><span>상대 진영 쪽</span></div>'
        + '<div style="display:flex; justify-content:space-between;"><span>상대 진영 누적</span><b data-a="cum"></b></div>'
        + '<div style="display:flex; justify-content:space-between;"><span>공격 전개</span><b data-a="ent"></b></div>'
        + '<div data-a="sc" style="font-weight:800; font-size:1.15em;"></div>'
        + '<div style="font-size:.82em; opacity:.65;">카메라가 공을 따라간 방향 기준</div>';
      host.appendChild(ov);
      // 접힌 상태: 점 단추만. 점을 누르면 접히고, 단추를 누르면 펴짐(브라우저에 기억)
      const pill = document.createElement('div');
      pill.title = '경기 흐름 펴기';
      pill.style.cssText = 'position:absolute; left:3%; top:4%; display:none; align-items:center; gap:.45em; padding:.45em .8em; border-radius:999px; background:rgba(10,10,10,.62); color:#fff; font-weight:800; cursor:pointer;';
      pill.innerHTML = '<span style="display:block; width:.8em; height:.8em; border-radius:50%; background:#C71F10; box-shadow:0 0 0 2px rgba(255,255,255,.85);"></span>경기 흐름';
      host.appendChild(pill);
      try { this._ovFold = localStorage.getItem('hw_ov_fold') === '1'; } catch (e) { this._ovFold = false; }
      const setFold = v => { this._ovFold = v; try { localStorage.setItem('hw_ov_fold', v ? '1' : '0'); } catch (e) {} this.showAnalysisBox(); };
      ov.querySelector('[data-a="fold"]').addEventListener('click', () => setFold(true));
      pill.addEventListener('click', () => setFold(false));
      const bn = document.createElement('div');
      bn.style.cssText = 'position:absolute; left:50%; top:9%; transform:translateX(-50%); padding:.3em .9em; border-radius:.45em; font-size:2.4em; font-weight:800; color:#fff; white-space:nowrap; display:none; pointer-events:none;';
      host.appendChild(bn);
      document.body.appendChild(host);
      this._yt = { host, fr, ov, bn, pill, key: '' };
      // 유튜브 플레이어에 재생 위치를 알려 달라고 하고(listening), 오는 위치(infoDelivery)로 박스를 다시 그린다
      fr.addEventListener('load', () => { try { fr.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube.com'); } catch (e) {} });
      window.addEventListener('message', e => {
        if (e.origin !== 'https://www.youtube.com' || e.source !== fr.contentWindow) return;
        let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
        const ct = d && d.info && d.info.currentTime;
        if (typeof ct === 'number') this.drawAnalysis(ct);
      });
      // 크기가 바뀌면 다음 프레임에 한 번만 다시 맞춘다(같은 프레임에서 되풀이되지 않게)
      const again = () => { if (this._ytRaf) return; this._ytRaf = requestAnimationFrame(() => { this._ytRaf = 0; this.placePlayer(); }); };
      window.addEventListener('resize', again);
      if (window.ResizeObserver) new ResizeObserver(again).observe(this.root);
    }
    const y = this._yt;
    if (!slot || !slot.dataset.src) {
      y.host.style.display = 'none';
      if (y.key) { y.fr.src = 'about:blank'; y.key = ''; }
      return;
    }
    const key = slot.dataset.key || slot.dataset.src;
    if (y.key !== key) {
      y.fr.src = slot.dataset.src; y.key = key;
      y.info = (this._anMap || {})[slot.dataset.src] || null;
      this.showAnalysisBox();
      if (y.info) this.drawAnalysis(y.info.t0); else y.bn.style.display = 'none';
    }
    const r = slot.getBoundingClientRect();
    const pos = [Math.round(r.top + window.scrollY), Math.round(r.left + window.scrollX), Math.round(r.width), Math.round(r.height)];
    if (y.host.style.display === 'block' && y.pos === pos.join()) return;
    y.pos = pos.join();
    Object.assign(y.host.style, { display: 'block', top: pos[0] + 'px', left: pos[1] + 'px', width: pos[2] + 'px', height: pos[3] + 'px' });
    y.host.style.fontSize = Math.max(9, Math.min(13, pos[2] / 48)).toFixed(1) + 'px';   // 박스 글자는 영상 폭에 맞춰
  }
  // 분석 박스 보이기: 분석 없는 영상이면 둘 다 숨김, 있으면 접힘 상태에 따라 박스 또는 점 단추
  showAnalysisBox() {
    const y = this._yt; if (!y) return;
    const on = !!y.info;
    y.ov.style.display = on && !this._ovFold ? 'flex' : 'none';
    y.pill.style.display = on && this._ovFold ? 'flex' : 'none';
  }
  // 재생 위치 t초의 분석 박스·골 배너
  drawAnalysis(t) {
    const y = this._yt, info = y && y.info;
    if (!info) return;
    const an = info.an, i = Math.max(0, Math.min(an.f.length - 1, Math.floor(t / an.s)));
    const q = k => y.ov.querySelector('[data-a="' + k + '"]');
    q('nd').style.left = an.f[i] + '%';
    q('cum').textContent = an.c[i] + '%';
    let ne = 0; for (let k = 0; k < (an.e || []).length; k += 2) if (an.e[k] <= t) ne++;
    q('ent').textContent = ne + '회';
    const us = info.goals.filter(g => g.k === 'goal' && g.t <= t).length, th = info.goals.filter(g => g.k === 'lost' && g.t <= t).length;
    q('sc').textContent = '화랑 ' + us + ' : ' + th + ' 상대';
    const g = info.goals.find(g => g.t <= t && t < g.t + 6);
    if (g) { y.bn.textContent = g.k === 'goal' ? '골! 화랑' : '실점'; y.bn.style.background = g.k === 'goal' ? 'rgba(199,31,16,.92)' : 'rgba(20,20,20,.9)'; y.bn.style.display = 'block'; }
    else y.bn.style.display = 'none';
  }
  mapAfterRender() {
    const slot = el('venueMap');
    if (!slot) return;
    const d = slot.dataset;
    const key = [d.lat, d.lng, d.address, d.name].join('|');
    if (this._mapFail === key) { slot.style.display = 'none'; return; }
    if (!this._mapEl) {
      this._mapEl = document.createElement('div');
      this._mapEl.style.cssText = 'width:100%; height:100%;';
    }
    slot.appendChild(this._mapEl);
    if (!this._venue || this._venue.key !== key) {
      const saved = d.lat && d.lng ? { lat: Number(d.lat), lng: Number(d.lng) } : null;
      this._venue = { key, promise: saved ? loadKakaoMaps().then(() => saved).catch(() => null) : geocode(d.address, d.name) };
    }
    this._venue.promise.then(coord => {
      const cur = el('venueMap');
      if (!coord) { this._mapFail = key; if (cur) cur.style.display = 'none'; return; }
      const km = window.kakao.maps;
      const pos = new km.LatLng(coord.lat, coord.lng);
      if (!this._map) {
        this._map = new km.Map(this._mapEl, { center: pos, level: 4 });
        this._marker = new km.Marker({ map: this._map });
        this._info = new km.InfoWindow({});
      }
      this._map.relayout();
      this._map.setCenter(pos);
      if (this._mapKey === key) return;
      this._mapKey = key;
      this._marker.setPosition(pos);
      this._info.setContent(`<div style="padding:4px 8px; font-size:12px; font-weight:700; color:#141414; white-space:nowrap;">${escapeHtml(d.name)}</div>`);
      this._info.open(this._map, this._marker);
    });
  }

  // ── 템플릿 값 ──
  renderVals() {
    const st = this.state, mob = st.isMobile;
    const loaded = this.members !== null && this.schedules !== null;
    const members = this.members || [], schedules = this.schedules || [];
    const byId = {};
    members.forEach(m => { byId[m.id] = m; });
    const nameOf = id => (byId[id] ? byId[id].name : guestById[id] ? guestById[id].name : '');
    const collator = new Intl.Collator('ko');
    const sorted = [...members].sort((a, b) => collator.compare(a.name, b.name));
    const me = byId[st.me] || null;
    const meId = me ? me.id : null;
    const isAdmin = !!(me && me.admin);
    const keyOf = m => m.name.replace(/\s/g, '');

    const today = localDate(), cut = cutDate();
    const upcomingAll = schedules.filter(s => s.date >= cut);
    const pastAll = schedules.filter(s => s.date < cut).reverse();
    const next = upcomingAll[0] || null;
    const statusOf = (s, id) => (s && s.rsvp && s.rsvp[id]) || null;
    // 일정 하나의 용병(등록한 순서). 용병은 참석 인원에 더해 센다
    const guestsOf = s => Object.entries((s && s.guests) || {}).map(([id, v]) => ({ id, name: v.name, by: v.by, at: v.at || 0 })).sort((a, b) => a.at - b.at);
    const nextGuests = guestsOf(next);
    const guestById = {};
    nextGuests.forEach(x => { guestById[x.id] = x; });
    // 일정 하나의 응답 집계(명단에 있는 사람만 센다)
    const tally = s => {
      const g = { attend: [], maybe: [], absent: [], none: [] };
      sorted.forEach(m => { g[statusOf(s, m.id) || 'none'].push(m); });
      return g;
    };
    const dateParts = s => {
      const d = new Date(s.date + 'T00:00:00');
      return { md: (d.getMonth() + 1) + '.' + d.getDate(), dow: DOW[d.getDay()], month: (d.getMonth() + 1) + '월' };
    };
    const ddayOf = s => { const n = Math.round((new Date(s.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000); return n <= 0 ? 'D-DAY' : 'D-' + n; };
    // 상대 표시: 상대 칸에 '자체전'이면 자체전, 비었거나 '미정'이면 지난 경기는 '상대 미기록'·다가오는 경기는 '상대 미정'
    const matchLabel = s => {
      const o = (s.opponent || '').trim();
      if (/^자체\s*(전|경기)$/.test(o)) return '자체전';
      if (o && o !== '미정') return 'vs ' + o;
      return s.date < cut ? '상대 미기록' : '상대 미정';
    };

    // 탭
    const go = k => () => { this.setState({ tab: k }); window.scrollTo(0, 0); };
    const tabs = [['home', '홈'], ['video', '영상'], ['schedule', '일정'], ['records', '기록'], ['members', '구성원']].map(([k, l]) => {
      const on = st.tab === k;
      return { label: l, onClick: go(k), color: on ? '#141414' : '#6B6B6B', weight: on ? 800 : 600, bar: on ? '#C71F10' : 'transparent' };
    });
    const ui = mob
      ? { headPad: '10px 16px', logo: '46px', title: '22px', topTabs: 'none', bottomTabs: 'flex', bottomPad: '84px', mainPad: '14px 12px 0', gap: '10px', cardPad: '16px', homeCols: 'minmax(0,1fr)', homeAreas: '"a" "f" "u"', heroDate: '34px', mapH: '160px', groupCols: 'minmax(0,1fr)', groupGap: '6px', pitchMaxHome: '100%', pitchMaxTab: '100%', fmCols: 'minmax(0,1fr)', pageTitle: '22px', schedCols: 'minmax(0,1fr)', listPad: '8px 12px', memberCols: 'minmax(0,1fr)', searchW: '100%', formCols: 'minmax(0,1fr)', formCols3: 'minmax(0,1fr)' }
      : { headPad: '8px 32px', logo: '52px', title: '23px', topTabs: 'flex', bottomTabs: 'none', bottomPad: '48px', mainPad: '28px 32px 0', gap: '16px', cardPad: '20px 22px', homeCols: 'minmax(0,1fr) minmax(0,440px)', homeAreas: '"a f" "u f"', heroDate: '40px', mapH: '240px', groupCols: '64px minmax(0,1fr)', groupGap: '10px', pitchMaxHome: '100%', pitchMaxTab: '460px', fmCols: 'minmax(0,1.05fr) minmax(0,1fr)', pageTitle: '26px', schedCols: 'repeat(2, minmax(0,1fr))', listPad: '10px 16px', memberCols: 'repeat(2, minmax(0,1fr))', searchW: '260px', formCols: 'repeat(2, minmax(0,1fr))', formCols3: 'repeat(3, minmax(0,1fr))' };

    // 안내 카드: 불러오는 중 · 오류 · 다음 경기 없음(홈, 포메이션)
    const needsNext = st.tab === 'home' || st.tab === 'formation';
    const notice = this.loadError ? { title: '연결에 문제가 있어요', text: this.loadError }
      : !loaded ? { title: '불러오는 중이에요', text: '잠시만 기다려 주세요.' }
      : needsNext && !next ? { title: '등록된 다음 경기가 없어요', text: isAdmin ? '일정 탭에서 "일정 추가"를 눌러 경기를 등록해 주세요.' : '운영진이 일정을 올리면 여기에서 참석 여부를 누를 수 있어요.' }
      : null;
    const ready = loaded && !this.loadError;

    // ── 이름 선택 창 ──
    const pickList = sorted.map(m => ({
      name: m.name, key: keyOf(m), bg: m === me ? '#141414' : '#FFFFFF', fg: m === me ? '#FFFFFF' : '#141414', bd: m === me ? '#141414' : '#E2E1DC',
      onClick: () => { try { localStorage.setItem('hwarang_me', m.id); } catch (e) {} this.setState({ me: m.id, pickerOpen: false, rsvpEditing: true }); this.applyPendingRsvp(); }
    }));

    // ── 다가오는 경기 · 내 참석 · 참석 현황 ──
    const g = tally(next);
    const cnt = { attend: g.attend.length + nextGuests.length, maybe: g.maybe.length, absent: g.absent.length, none: g.none.length, total: sorted.length,
      guestNote: nextGuests.length ? ' + 용병 ' + nextGuests.length + '명' : '' };
    const headcount = cnt.total + nextGuests.length;   // 막대 그래프의 분모(구성원 + 용병)
    const pct = (n, total) => (n / (total || 1) * 100).toFixed(1) + '%';
    const myStatus = me ? statusOf(next, meId) : null;
    const rsvpButtons = ['attend', 'maybe', 'absent'].map(k => {
      const on = myStatus === k;
      return { label: LABEL[k], bg: on ? PAL[k][2] : '#FFFFFF', color: on ? PAL[k][3] : '#141414', bd: on ? PAL[k][2] : '#E2E1DC',
        onClick: () => { if (next) this.setRsvp(next.id, k); this.setState({ rsvpEditing: false, rosterOpen: false }); } };
    });
    const rsvpCollapsed = !!(me && myStatus && !st.rsvpEditing);
    // 명단: 내가 이미 투표했으면(또는 휴대폰이면) 접힌 채로 시작, 투표 버튼을 누르면 접힘. '명단 보기'로 다시 펼친다
    const rosterOpen = st.rosterOpen == null ? !mob && !myStatus : st.rosterOpen;
    const chip = (m, k) => {
      const p = k ? PAL[k] : ['#FFFFFF', '#5F5F5F'];
      return m === me ? { name: m.name, bg: '#141414', fg: '#FFFFFF', weight: 800, bd: '#141414', cursor: 'default' }
        : { name: m.name, bg: p[0], fg: p[1], weight: 600, bd: k ? 'transparent' : '#E2E1DC', cursor: 'default' };
    };
    // 용병 이름표. 데려온 사람과 운영진에게는 ×가 붙고, 누르면 뺄 수 있다
    const guestChip = x => {
      const mine = isAdmin || x.by === meId;
      return { name: (/^용병/.test(x.name) ? x.name : x.name + ' · 용병') + (mine ? ' ×' : ''), bg: '#F6F0DC', fg: '#6E5513', weight: 700, bd: 'transparent', cursor: mine ? 'pointer' : 'default',
        onClick: mine ? () => { if (confirm('용병 ' + x.name + ' 님을 뺄까요?')) this.removeGuest(next, x.id); } : undefined };
    };
    const meFirst = list => [...list].sort((a, b) => (b === me) - (a === me));
    const groups = [['attend', '참석', '#A3190B'], ['maybe', '미정', '#6E5513'], ['absent', '불참', '#4F4F4F'], ['none', '미응답', '#5F5F5F']].map(([k, l, c]) => {
      const names = meFirst(g[k]).map(m => chip(m, k === 'none' ? null : k)).concat(k === 'attend' ? nextGuests.map(guestChip) : []);
      return { label: l, color: c, n: names.length, names };
    });
    const short = MIN_PLAYERS - cnt.attend;
    const quorum = short <= 0 ? { label: '경기 가능 · 여유 ' + (-short) + '명', bg: '#141414', fg: '#FFFFFF' } : { label: short + '명 더 필요', bg: '#FBE9E6', fg: '#A3190B' };
    const nextApps = next ? navLinks(next) : [];
    const np = next ? dateParts(next) : null;
    const nextVals = next ? {
      dday: ddayOf(next), date: np.md + ' (' + np.dow + ')', time: next.time || '', venue: next.venue || '구장 미정', address: next.address || '',
      opponent: next.opponent || '', hasOpp: !!next.opponent,
      lat: typeof next.lat === 'number' ? next.lat : '', lng: typeof next.lng === 'number' ? next.lng : '',
      navApps: nextApps, navCols: navCols(nextApps)
    } : {};

    // ── 포메이션 ──
    const draft = next && st.draft && st.draftFor === next.id ? st.draft : null;
    const QE = draft || this.quartersOf(next);
    const nq = QE ? QE.length : qnOf(next), QR = range(nq), qi = Math.min(st.q, nq - 1);
    const fmReadyData = !!QE && QE.some(q => q.some(x => x[1] != null));
    const editing = isAdmin && !!QE;
    const setQ = fn => this.setState(() => {
      const cur = QE.map(q => q.map(x => x.slice()));
      fn(cur);
      return { draft: cur, draftFor: next.id, sel: null, dirty: true, fmError: '' };
    });
    const posOf = (id, qi) => { if (!QE) return null; const f = QE[qi].find(x => x[1] === id); return f ? posName(f[0]) : null; };
    const slots = QE ? QE[qi] : SLOTS.map(s => [s, null]);
    const sel = st.sel;
    const clickSlot = idx => () => {
      if (!editing) return;
      if (sel && sel.kind === 'slot' && sel.idx === idx) return this.setState({ sel: null });
      if (sel && sel.kind === 'slot') return setQ(c => { const a = c[qi]; const t = a[idx][1]; a[idx][1] = a[sel.idx][1]; a[sel.idx][1] = t; });
      if (sel && sel.kind === 'bench') return setQ(c => { c[qi][idx][1] = sel.id; });
      this.setState({ sel: { kind: 'slot', idx } });
    };
    const pitchSlots = slots.map(([s, id], idx) => {
      const isMe = fmReadyData && id != null && id === meId;
      const isSel = editing && sel && sel.kind === 'slot' && sel.idx === idx;
      const base = { onClick: clickSlot(idx), cursor: editing ? 'pointer' : 'default', x: XY[s][0] + '%', y: XY[s][1] + '%', pos: posName(s) };
      if (isSel) return { ...base, name: id != null ? nameOf(id) : '선택', bg: '#D8C07A', fg: '#141414', posFg: '#3D2F08', bd: '#FFFFFF', bdStyle: 'solid', shadow: '0 0 0 4px rgba(255,255,255,.45), 0 2px 8px rgba(0,0,0,.3)' };
      if (id == null) return { ...base, name: '', bg: 'rgba(255,255,255,.1)', fg: '#FFFFFF', posFg: '#FFFFFF', bd: 'rgba(255,255,255,.6)', bdStyle: 'dashed', shadow: 'none' };
      return { ...base, name: nameOf(id), bg: isMe ? '#C71F10' : '#FFFFFF', fg: isMe ? '#FFFFFF' : '#141414', posFg: isMe ? '#F3DFA0' : '#6B6B6B', bd: isMe ? '#D8C07A' : '#FFFFFF', bdStyle: 'solid', shadow: isMe ? '0 0 0 3px rgba(216,192,122,.55), 0 2px 6px rgba(0,0,0,.25)' : '0 2px 6px rgba(0,0,0,.2)' };
    });
    const myPos = QR.map(i => (me && fmReadyData ? posOf(meId, i) : null));
    const inLineup = !!me && fmReadyData && myPos.some(Boolean);
    let summaryText;
    if (!fmReadyData) summaryText = '포메이션이 올라오면 여기 바로 보여요';
    else if (!me) summaryText = '이름을 선택하면 내 포지션이 보여요';
    else if (!inLineup) summaryText = '이번 경기 포메이션에 없어요';
    else {
      const play = myPos.map((p, i) => (p ? (i + 1) + '쿼터 ' + p : null)).filter(Boolean);
      const rest = myPos.map((p, i) => (p ? null : i + 1)).filter(Boolean);
      summaryText = play.join(' · ') + (rest.length ? ' · ' + rest.join(', ') + '쿼터 휴식' : '');
    }
    const mySummary = { text: summaryText, bg: inLineup ? '#FBE9E6' : '#F6F6F4', fg: inLineup ? '#141414' : '#5F5F5F', fg2: inLineup ? '#141414' : '#5F5F5F', labelFg: inLineup ? '#A3190B' : '#5F5F5F' };
    const myQuarters = QR.map(i => {
      const p = myPos[i];
      return { q: (i + 1) + '쿼터', pos: p || (fmReadyData && me ? '휴식' : '-'), bg: p ? '#C71F10' : '#F6F6F4', fg: p ? '#FFFFFF' : '#5F5F5F', sub: p ? '#F3DFA0' : '#6B6B6B' };
    });
    const qButtons = QR.map(i => {
      const on = qi === i;
      return { label: (i + 1) + '쿼터', onClick: () => this.setState({ q: i, sel: null }), bg: on ? '#141414' : '#FFFFFF', fg: on ? '#FFFFFF' : '#141414', bd: on ? '#141414' : '#E2E1DC', dot: myPos[i] ? '#E53B1F' : 'transparent' };
    });
    const attendIds = g.attend.map(m => m.id).concat(nextGuests.map(x => x.id));
    const restIds = attendIds.filter(id => !posOf(id, qi));
    const filled = slots.filter(x => x[1] != null).length;
    const qInfo = QE ? { field: (qi + 1) + '쿼터 휴식 ' + restIds.length + '명', rest: '필드 ' + filled + '/11' } : { field: '4-2-3-1 · 11명', rest: '배치 전' };
    const benchList = (QE ? restIds : []).map(id => {
      const isSel = editing && sel && sel.kind === 'bench' && sel.id === id;
      const isMe = id === meId;
      return { name: nameOf(id), h: editing ? '40px' : '32px', cursor: editing ? 'pointer' : 'default',
        bg: isSel ? '#D8C07A' : (isMe ? '#141414' : '#F3F3F0'), fg: isSel ? '#141414' : (isMe ? '#FFFFFF' : '#141414'),
        bd: isSel ? '#D8C07A' : (editing ? '#D8D7D0' : 'transparent'), bdStyle: editing && !isSel ? 'dashed' : 'solid',
        onClick: () => {
          if (!editing) return;
          if (isSel) return this.setState({ sel: null });
          if (sel && sel.kind === 'slot') return setQ(c => { c[qi][sel.idx][1] = id; });
          this.setState({ sel: { kind: 'bench', id } });
        } };
    });
    // 선수가 들어 있는 자리를 골랐을 때만: 그 자리를 비우는 버튼
    if (editing && sel && sel.kind === 'slot' && slots[sel.idx][1] != null) {
      benchList.push({ name: '이 자리 비우기', h: '40px', cursor: 'pointer', bg: '#FFFFFF', fg: '#A3190B', bd: '#E8B4AD', bdStyle: 'solid', onClick: () => setQ(c => { c[qi][sel.idx][1] = null; }) });
    }
    const editHint = sel ? (sel.kind === 'bench' ? nameOf(sel.id) + ' 선택됨 · 넣을 자리를 누르세요' : '선택됨 · 바꿀 선수나 휴식 인원을 누르세요') : '선수를 눌러 선택한 뒤, 다른 자리나 휴식 인원을 누르면 바뀌어요';
    const saveBtn = st.dirty ? { label: '저장', bg: '#C71F10', fg: '#FFFFFF' } : { label: st.savedAt ? '저장됨' : '변경 없음', bg: '#FFFFFF', fg: '#6B6B6B' };
    const qHeads = QR.map(i => ({ label: (i + 1) + 'Q', fg: qi === i ? '#C71F10' : '#5F5F5F' }));
    // 출전표: 참석자 + (참석이 아니어도) 배치된 사람 + 용병
    const placedIds = QE ? [...new Set(QE.flatMap(q => q.map(x => x[1]).filter(id => id != null)))] : [];
    const lineupMembers = meFirst(sorted.filter(m => attendIds.includes(m.id) || placedIds.includes(m.id)))
      .concat(nextGuests.map(x => ({ id: x.id, name: x.name + ' (용병)' })));
    const lineupRows = lineupMembers.map(m => {
      const isMe = m === me;
      const ps = QR.map(i => posOf(m.id, i));
      return {
        name: isMe ? m.name + ' (나)' : m.name, weight: isMe ? 800 : 600, fg: isMe ? '#A3190B' : '#141414', bg: isMe ? '#FBE9E6' : 'transparent', radius: isMe ? '8px' : '0',
        count: ps.filter(Boolean).length + '/' + nq,
        cells: ps.map((p, i) => ({ text: p || '휴식', size: p ? '13px' : '12px', weight: p ? 800 : 600, fg: p ? (isMe ? '#FFFFFF' : '#141414') : '#8A8A85', bg: p ? (isMe ? '#C71F10' : (qi === i ? '#F6F0DC' : '#F3F3F0')) : 'transparent' }))
      };
    });

    // ── 이후 일정(홈) ──
    const upcoming = upcomingAll.slice(1, 4).map((s, i) => {
      const p = dateParts(s);
      return { date: p.md, dow: p.dow + '요일', venue: s.venue || '구장 미정', meta: [s.time, matchLabel(s)].filter(Boolean).join(' · '), bt: i ? '1px solid #F0EFEB' : 'none' };
    });

    // ── 일정 탭 ──
    const isPast = st.schedView === 'past';
    const list = isPast ? pastAll : upcomingAll;
    const schedSel = st.schedSel === undefined ? (next ? next.id : null) : st.schedSel;
    const chipFor = k => (k ? { chip: LABEL[k], chipBg: PAL[k][0], chipFg: PAL[k][1], chipBd: 'transparent' } : { chip: '미응답', chipBg: '#FFFFFF', chipFg: '#5F5F5F', chipBd: '#E2E1DC' });
    const schedItems = list.map(s => {
      const t = tally(s), p = dateParts(s), mine = me ? statusOf(s, meId) : null, open = schedSel === s.id;
      const gs = guestsOf(s).length;
      const a = t.attend.length + gs, m2 = t.maybe.length, x = t.absent.length, total = sorted.length + gs;
      const apps = open ? navLinks(s) : [];
      const gray = text => ({ chip: text, chipBg: '#F0F0EC', chipFg: '#4F4F4F', chipBd: 'transparent' });
      // 지난 일정: 출석 기록이 하나도 없으면 "기록 없음", 있으면 내 출석 여부(이름을 안 골랐으면 참석 인원)
      const res = resultOf(s), resQs = res && Array.isArray(res.qs) ? res.qs : [];
      const resLabel = res ? (res.our > res.their ? '승' : res.our < res.their ? '패' : '무') : '';
      const scorerTotals = res ? scorersOf(res) : {};
      const scorerName = k => (k === 'merc' ? '용병' : k === 'og' ? '상대 자책골' : k === 'unk' ? '득점자 미상' : (byId[k] ? byId[k].name : '?'));
      const pastChip = !a ? gray('기록 없음') : !me ? gray('참석 ' + a) : mine === 'attend' ? { chip: '출석', chipBg: '#141414', chipFg: '#FFFFFF', chipBd: 'transparent' } : gray('결석');
      return {
        ...(isPast ? pastChip : chipFor(mine)),
        monthLabel: p.month, date: p.md, dow: p.dow + '요일', venue: s.venue || '구장 미정', address: s.address || '',
        isNext: !isPast && next && s.id === next.id, dday: ddayOf(s), dateFg: isPast ? '#6B6B6B' : '#141414',
        meta: [s.time, matchLabel(s), res ? res.our + ':' + res.their + ' ' + resLabel : '', '참석 ' + a + '명'].filter(Boolean).join(' · '),
        hasResult: !!res,
        res: res ? {
          score: '화랑 ' + res.our + ' : ' + res.their + (s.opponent ? ' ' + s.opponent : ''), label: resLabel,
          bg: resLabel === '승' ? '#C71F10' : resLabel === '패' ? '#6B6B66' : '#D8C07A', fg: resLabel === '무' ? '#3D2F08' : '#FFFFFF',
          hasQs: resQs.length > 0, cols: resQs.length || 1, qs: resQs.map((q, i) => ({ label: (i + 1) + 'Q', score: q.our + ':' + q.their, fg: q.our > q.their ? '#A3190B' : '#141414' })),
          scorers: Object.entries(scorerTotals).sort((x, y) => y[1] - x[1]).map(([k, n]) => scorerName(k) + (n > 1 ? ' ' + n : '')).join(' · '),
          hasScorers: Object.keys(scorerTotals).length > 0,
          video: ytUrl(res.video) || ''
        } : {},
        canRecord: isAdmin && s.date <= today, recordLabel: res ? '경기 기록 수정' : '경기 기록 입력',
        onRecord: () => {
          const nm = k => (k === 'merc' ? '용병' : k === 'og' ? '자책골' : k === 'unk' ? '미상' : (byId[k] ? byId[k].name : '?'));
          const scTxt = sc => (Object.keys(sc || {}).length ? ' (' + Object.entries(sc).map(([k, n]) => nm(k) + (n > 1 ? n : '')).join(', ') + ')' : '');
          const txt = res && !resQs.length ? (res.qn ? range(res.qn).map(i => i + 1).join(',') + '쿼터 ' : '합계 ') + res.our + ' : ' + res.their + scTxt(res.sc) : res ? res.qs.map((q, i) => (i + 1) + '쿼터 - ' + q.our + ' : ' + q.their + (Object.keys(q.sc || {}).length ? ' (' + Object.entries(q.sc).map(([k, n]) => nm(k) + (n > 1 ? n : '')).join(', ') + ')' : '')).join('\n') : '';
          this.setState({ resultForm: { id: s.id, title: p.md + ' ' + (s.opponent ? 'vs ' + s.opponent : s.venue || '') + ' 경기 기록', text: txt, video: (res && res.video) || '', clips: res ? clipsText(res.clips) : '', hasExisting: !!res, preview: [], errors: [], warnings: [], total: '', error: '', checked: false } });
          window.scrollTo(0, 0);
        },
        open, onClick: () => this.setState({ schedSel: open ? null : s.id }),
        a, guestNote: gs ? ' (용병 ' + gs + '명 포함)' : '', m: m2, x, none: t.none.length, barA: pct(a, total), barM: pct(m2, total), barX: pct(x, total),
        canAnswer: !isPast && !!me, navApps: apps, navCols: navCols(apps),
        buttons: ['attend', 'maybe', 'absent'].map(k => { const on = mine === k; return { label: LABEL[k], bg: on ? PAL[k][2] : '#FFFFFF', color: on ? PAL[k][3] : '#141414', bd: on ? PAL[k][2] : '#E2E1DC', onClick: () => this.setRsvp(s.id, k) }; }),
        canEdit: isAdmin,
        onEdit: () => this.setState({ schedForm: { id: s.id, title: '일정 수정', saveLabel: '저장', date: s.date, time: s.time || '', venue: s.venue || '', address: s.address || '', opponent: s.opponent || '', error: '' } }),
        onDelete: () => { if (confirm(p.md + ' ' + (s.venue || '') + ' 일정을 지울까요? 참석 응답과 포메이션도 함께 지워져요.')) this.db.collection('hw_schedules').doc(s.id).delete().catch(() => alert('지우지 못했어요. 잠시 후 다시 눌러 주세요.')); }
      };
    });
    const schedGroups = [...new Set(schedItems.map(it => it.monthLabel))].map(mo => { const items = schedItems.filter(it => it.monthLabel === mo); return { month: mo, n: items.length, items }; });
    const schedViews = [['upcoming', '예정 ' + upcomingAll.length], ['past', '지난 일정']].map(([k, l]) => {
      const on = st.schedView === k;
      return { label: l, bg: on ? '#141414' : '#FFFFFF', fg: on ? '#FFFFFF' : '#141414', bd: on ? '#141414' : '#E2E1DC', onClick: () => this.setState({ schedView: k, schedSel: k === 'upcoming' ? undefined : null }) };
    });
    const answeredN = me ? upcomingAll.filter(s => statusOf(s, meId)).length : 0;
    const schedSub = isPast
      ? '지난 일정 ' + pastAll.length + '경기' + (me && pastAll.some(s => tally(s).attend.length) ? ' · 내 출석 ' + pastAll.filter(s => statusOf(s, meId) === 'attend').length + '회' : '')
      : (me ? '예정 ' + upcomingAll.length + '경기 중 ' + answeredN + '경기 응답했어요. 미리 응답해 두면 운영진이 인원 파악하기 쉬워요.' : '이름을 선택하면 일정별로 미리 응답할 수 있어요.');
    const sf = st.schedForm;

    // ── 구성원 탭 ──
    const year = today.slice(0, 4);
    // 참석률은 올해 지난 일정 중 출석 기록이 있는 경기만 센다(기록 없이 일정만 올린 경기는 뺀다)
    const seasonPast = pastAll.filter(s => s.date.slice(0, 4) === year && tally(s).attend.length > 0);
    const counts = { all: sorted.length, GK: 0, DF: 0, MF: 0, FW: 0 };
    sorted.forEach(m => { if (counts[m.pos] != null) counts[m.pos]++; });
    const posFilters = [['all', '전체'], ['GK', 'GK'], ['DF', 'DF'], ['MF', 'MF'], ['FW', 'FW']].map(([k, l]) => {
      const on = st.memberPos === k;
      return { label: l, n: counts[k], bg: on ? '#141414' : '#FFFFFF', fg: on ? '#FFFFFF' : '#141414', sub: on ? '#D8C07A' : '#6B6B6B', bd: on ? '#141414' : '#E2E1DC', onClick: () => this.setState({ memberPos: k }) };
    });
    const mq = this.memberQuery.replace(/\s/g, '');
    const inPos = meFirst(sorted.filter(m => st.memberPos === 'all' || m.pos === st.memberPos));
    const memberRows = inPos.map(m => {
      const isMe = m === me, att = seasonPast.filter(s => statusOf(s, m.id) === 'attend').length;
      const rate = seasonPast.length ? Math.round(att / seasonPast.length * 100) + '%' : '0%';
      return { name: isMe ? m.name + ' (나)' : m.name, key: keyOf(m), pos: m.pos || '-',
        rate, display: !mq || keyOf(m).includes(mq) ? 'grid' : 'none',
        weight: isMe ? 800 : 700, fg: isMe ? '#A3190B' : '#141414', bg: isMe ? '#FBE9E6' : 'transparent', radius: isMe ? '10px' : '0',
        posBg: m.pos === 'GK' ? '#F6F0DC' : '#F3F3F0', posFg: m.pos === 'GK' ? '#6E5513' : '#141414', posLine: m.pos === 'GK' ? '#D8C07A' : '#DDDCD6',
        onPos: e => this.setPos(m.id, e.target.value), barFg: seasonPast.length && att / seasonPast.length >= 0.7 ? '#C71F10' : '#A8A8A2',
        cursor: isAdmin ? 'pointer' : 'default',
        onClick: () => { if (isAdmin) { this.setState({ memberForm: { id: m.id, title: m.name + ' 수정', name: m.name, pos: m.pos || 'MF', role: m.admin ? 'admin' : 'member', canDelete: true, error: '' } }); window.scrollTo(0, 0); } } };
    });
    const mf = st.memberForm;

    // ── 기록 탭: 시즌별 결과·득점·출석(출석은 참석 응답이 있는 지난 경기만, 득점은 경기 기록이 있는 경기만) ──
    const hasRes = s => !!resultOf(s);
    const recYears = [...new Set(pastAll.filter(s => hasRes(s) || tally(s).attend.length).map(s => s.date.slice(0, 4)))].sort().reverse();
    const recYear = st.recYear && recYears.includes(st.recYear) ? st.recYear : (recYears[0] || year);
    const recGames = pastAll.filter(s => s.date.slice(0, 4) === recYear && (hasRes(s) || tally(s).attend.length));
    const played = recGames.filter(hasRes), attGames = recGames.filter(s => tally(s).attend.length);
    const wdl = { w: 0, d: 0, l: 0 }; let gf = 0, ga = 0;
    played.forEach(s => { gf += s.result.our; ga += s.result.their; wdl[s.result.our > s.result.their ? 'w' : s.result.our < s.result.their ? 'l' : 'd']++; });
    const goals = {}, att = {};
    played.forEach(s => Object.entries(scorersOf(s.result)).forEach(([k, n]) => { goals[k] = (goals[k] || 0) + n; }));
    attGames.forEach(s => tally(s).attend.forEach(m => { att[m.id] = (att[m.id] || 0) + 1; }));
    const avgAtt = attGames.length ? (attGames.reduce((x, s) => x + tally(s).attend.length + guestsOf(s).length, 0) / attGames.length).toFixed(1) : '-';
    const rankRows = (entries, fmt) => {
      let rank = 0, prev = null;
      return entries.map(([id, n], i) => { if (n !== prev) { rank = i + 1; prev = n; } const isMe = String(id) === String(meId);
        return { rank, name: byId[id] ? byId[id].name : '?', ...fmt(n), weight: isMe ? 800 : 600, fg: isMe ? '#A3190B' : '#141414', bg: isMe ? '#FBE9E6' : 'transparent' }; });
    };
    const scorerList = rankRows(Object.entries(goals).filter(([k]) => byId[k]).sort((a, b) => b[1] - a[1] || collator.compare(byId[a[0]].name, byId[b[0]].name)),
      n => ({ value: n + '골', bar: (n / Math.max(1, ...Object.values(goals)) * 100).toFixed(0) + '%' }));
    const attAll = rankRows(Object.entries(att).filter(([k]) => byId[k]).sort((a, b) => b[1] - a[1] || collator.compare(byId[a[0]].name, byId[b[0]].name)),
      n => ({ value: n + '/' + attGames.length, bar: (n / Math.max(1, attGames.length) * 100).toFixed(0) + '%' }));
    const recGameRows = recGames.map(s => {
      const p = dateParts(s), r = hasRes(s) ? s.result : null, t = tally(s), gs = guestsOf(s), open = st.recOpen === s.id;
      const lab = r ? (r.our > r.their ? '승' : r.our < r.their ? '패' : '무') : '';
      const sc = r ? scorersOf(r) : {}, rq = r && Array.isArray(r.qs) ? r.qs : [];
      const scName = k => (k === 'merc' ? '용병' : k === 'og' ? '상대 자책골' : k === 'unk' ? '득점자 미상' : (byId[k] ? byId[k].name : '?'));
      return {
        date: p.md, dow: p.dow, title: matchLabel(s) || s.venue || '', venue: s.venue || '',
        score: r ? r.our + ' : ' + r.their : '기록 없음', label: lab, hasLabel: !!lab,
        // 왼쪽 결과 색 줄: 승 연두 · 패 빨강 · 무 금색 · 기록 없음은 줄 없음
        stripe: lab === '승' ? '#6CC04A' : lab === '패' ? '#E0453A' : lab === '무' ? '#D8C07A' : 'transparent',
        lbg: lab === '승' ? '#C71F10' : lab === '패' ? '#6B6B66' : '#D8C07A', lfg: lab === '무' ? '#3D2F08' : '#FFFFFF', scoreFg: r ? '#141414' : '#8A8A85',
        meta: (t.attend.length + gs.length ? '참석 ' + (t.attend.length + gs.length) + '명' : '참석 기록 없음') + (Object.keys(sc).length ? ' · 득점 ' + Object.entries(sc).sort((a, b) => b[1] - a[1]).map(([k, n]) => scName(k) + (n > 1 ? ' ' + n : '')).join(', ') : ''),
        open, onClick: () => this.setState({ recOpen: open ? null : s.id }),
        hasQs: rq.length > 0, qCols: rq.length || 1, qs: rq.length ? rq.map((q, i) => ({ label: (i + 1) + 'Q', score: q.our + ':' + q.their, fg: q.our > q.their ? '#A3190B' : '#141414' })) : [],
        attendees: meFirst(t.attend).map(m => ({ name: m.name, bg: m === me ? '#141414' : '#FBE9E6', fg: m === me ? '#FFFFFF' : '#A3190B' })).concat(gs.map(x => ({ name: /^용병/.test(x.name) ? x.name : x.name + ' · 용병', bg: '#F6F0DC', fg: '#6E5513' }))),
        noAttend: !t.attend.length && !gs.length,
        video: r ? ytUrl(r.video) || '' : ''
      };
    });
    // 홈 '최근 경기 기록': 경기 기록이 있는 지난 경기 최근 3개, 누르면 기록 탭에서 그 경기를 펼친다
    const recentGames = pastAll.filter(hasRes).slice(0, 3).map((s, i) => {
      const p = dateParts(s), r = s.result, sc = scorersOf(r);
      const lab = r.our > r.their ? '승' : r.our < r.their ? '패' : '무';
      const scName = k => (k === 'merc' ? '용병' : k === 'og' ? '상대 자책골' : k === 'unk' ? '미상' : (byId[k] ? byId[k].name : '?'));
      const n = tally(s).attend.length + guestsOf(s).length;
      return {
        date: p.md, dow: p.dow, title: matchLabel(s) || s.venue || '', score: r.our + ' : ' + r.their, label: lab, bt: i ? '1px solid #F0EFEB' : 'none',
        stripe: lab === '승' ? '#6CC04A' : lab === '패' ? '#E0453A' : '#D8C07A',
        lbg: lab === '승' ? '#C71F10' : lab === '패' ? '#6B6B66' : '#D8C07A', lfg: lab === '무' ? '#3D2F08' : '#FFFFFF',
        meta: [Object.keys(sc).length ? '득점 ' + Object.entries(sc).sort((a, b) => b[1] - a[1]).map(([k, c]) => scName(k) + (c > 1 ? ' ' + c : '')).join(', ') : '', n ? '참석 ' + n + '명' : ''].filter(Boolean).join(' · ') || (s.venue || ''),
        onClick: () => { this.setState({ tab: 'records', recYear: s.date.slice(0, 4), recOpen: s.id }); window.scrollTo(0, 0); }
      };
    });
    // 경기 영상: 영상 링크나 장면 표가 있는 경기, 최신순. 홈 카드와 영상 탭이 같은 모양(vidView)을 쓴다.
    const hasVid = s => { const r = resultOf(s); return !!(r && (ytUrl(r.video) || (Array.isArray(r.clips) && r.clips.length))); };
    const vidGames = (this.schedules || []).filter(s => s.date <= today && hasVid(s)).slice().reverse();
    const vidView = s => {
      const r = s.result, p = dateParts(s), clips = Array.isArray(r.clips) ? r.clips : [];
      const lab = r.our > r.their ? '승' : r.our < r.their ? '패' : '무';
      const sel = (st.vidSel || {})[s.id] || { i: 0, t: 0, n: 0 };
      const ci = Math.min(sel.i, Math.max(0, clips.length - 1)), clip = clips[ci];
      const yp = ytParts(r.video) || {};
      const opts = 'playsinline=1&rel=0&enablejsapi=1&origin=' + encodeURIComponent(location.origin) + (sel.n ? '&autoplay=1' : '') + (sel.t ? '&start=' + sel.t : '');
      const src = clip ? 'https://www.youtube.com/embed/' + clip.v + '?' + opts
        : yp.v ? 'https://www.youtube.com/embed/' + yp.v + '?' + opts
        : 'https://www.youtube.com/embed/videoseries?list=' + yp.list + '&' + opts;
      const pick = (i, t) => () => this.setState({ vidSel: { ...st.vidSel, [s.id]: { i, t, n: Date.now() } } });
      // 쿼터 버튼 점수: 이름의 숫자(1쿼터·2Q)로 쿼터를 찾고, 없으면 영상 수와 쿼터 수가 같을 때 순서대로
      const qs = Array.isArray(r.qs) ? r.qs : [];
      const qOf = (c, i) => { const m = /(\d+)\s*(쿼터|Q)/i.exec(c.label || ''); const k = m ? Number(m[1]) - 1 : clips.length === qs.length ? i : -1; return qs[k] || null; };
      const kind = (st.vidKind || {})[s.id] || 'all', listOpen = !!(st.vidList || {})[s.id];
      const setKind = k => () => this.setState({ vidKind: { ...st.vidKind, [s.id]: k }, vidList: { ...st.vidList, [s.id]: true } });
      const marks = clip ? (clip.marks || []).map(k => ({ ...k, kd: markKind(k.l) })) : [];
      const dur = clip && clip.d ? clip.d : Math.max(60, ...marks.map(k => (k.e || k.t) + 60));
      const pct = x => Math.min(100, Math.max(0, x / dur * 100)).toFixed(2) + '%';
      const isSel = k => !!(sel.n && sel.t === k.t && sel.i === ci);
      const counts = {}; marks.forEach(k => { counts[k.kd] = (counts[k.kd] || 0) + 1; });
      const shown = kind === 'all' ? marks : marks.filter(k => k.kd === kind);
      // 쿼터 분석(카메라 방향으로 잰 진영·공격 전개, result.clips[i].an). 영상 위 박스는 placePlayer가 재생 위치에 맞춰 그린다.
      const an = clip && clip.an && Array.isArray(clip.an.f) && clip.an.f.length ? clip.an : null;
      const anOpen = !!(st.vidAn || {})[s.id];
      const goalMarks = marks.filter(k => k.kd === 'goal' || k.kd === 'lost').map(k => ({ t: Number(k.t), k: k.kd }));
      let anUp = '', anDn = '';
      if (an) {
        const X = i => Math.min(1000, i * an.s / dur * 1000).toFixed(1), Y = v => 46 - v / 100 * 46;
        anUp = 'M0 23'; anDn = 'M0 23';
        an.f.forEach((v, i) => { anUp += ' L' + X(i) + ' ' + Math.min(23, Y(v)).toFixed(1); anDn += ' L' + X(i) + ' ' + Math.max(23, Y(v)).toFixed(1); });
        const xe = X(an.f.length - 1);
        anUp += ' L' + xe + ' 23 Z'; anDn += ' L' + xe + ' 23 Z';
        (this._anMap || (this._anMap = {}))[src] = { an, goals: goalMarks, t0: sel.t || 0 };
      }
      const anOpp = an ? Number(an.opp) : 0;
      return {
        id: s.id, date: p.md, dow: p.dow, title: matchLabel(s) || s.venue || '', venue: s.venue || '',
        score: r.our + ' : ' + r.their, label: lab,
        stripe: lab === '승' ? '#6CC04A' : lab === '패' ? '#E0453A' : '#D8C07A',
        lbg: lab === '승' ? '#C71F10' : lab === '패' ? '#6B6B66' : '#D8C07A', lfg: lab === '무' ? '#3D2F08' : '#FFFFFF',
        src, slotKey: src + '#' + sel.n,
        hasChips: clips.length > 1, chipCols: 'repeat(' + Math.min(clips.length, 6) + ', minmax(0,1fr))',
        chips: clips.map((c, i) => {
          const q = qOf(c, i), on = i === ci;
          return { label: c.label, onClick: pick(i, 0), bg: on ? '#141414' : '#FFFFFF', fg: on ? '#FFFFFF' : '#141414', bd: on ? '#141414' : '#E2E1DC',
            hasQ: !!q, q: q ? q.our + ' : ' + q.their : '', qfg: q && q.our > q.their ? (on ? '#FF8A7A' : '#C71F10') : on ? '#BDBDB8' : '#8A8A85' };
        }),
        hasMarks: marks.length > 0, durText: fmtSec(dur),
        dots: marks.map(k => {
          const K = KINDS[k.kd], dim = kind !== 'all' && k.kd !== kind;
          return { left: pct(k.t), z: isSel(k) ? 9 : K.z, sz: (isSel(k) ? K.sz + 4 : K.sz) + 'px', c: K.c, op: dim ? .2 : 1,
            ring: isSel(k) ? '0 0 0 3px rgba(20,20,20,.25)' : 'none', hasRange: k.e != null, rw: k.e != null ? pct(k.e - k.t) : '0%',
            tip: fmtSec(k.t) + ' ' + k.l, onClick: pick(ci, k.t) };
        }),
        kinds: [{ k: 'all', name: '전체', n: marks.length, c: '#141414' }].concat(['goal', 'lost', 'risk', 'chance', 'etc'].filter(k => counts[k]).map(k => ({ k, name: KINDS[k].name, n: counts[k], c: KINDS[k].c })))
          .map(x => { const on = listOpen && kind === x.k; return { name: x.name, n: x.n, dot: x.c, hasDot: x.k !== 'all', bg: on ? '#141414' : '#F5F5F3', fg: on ? '#FFFFFF' : '#141414', onClick: setKind(x.k) }; }),
        listOpen, listToggle: () => this.setState({ vidList: { ...st.vidList, [s.id]: !listOpen } }),
        listBtn: listOpen ? '장면 목록 접기 ▲' : '장면 목록 ' + marks.length + '개 보기 ▼',
        clipLabel: clip ? clip.label + (kind === 'all' ? ' 주요 장면' : ' · ' + KINDS[kind].name + ' ' + shown.length + '개') : '',
        marks: shown.map(k => ({ time: fmtSec(k.t) + (k.e != null ? '~' + fmtSec(k.e) : ''), label: k.l, kname: KINDS[k.kd].name, kc: KINDS[k.kd].c, onClick: pick(ci, k.t), bg: isSel(k) ? '#FBE9E6' : 'transparent' })),
        ytLink: ytUrl(r.video) || (clip ? 'https://www.youtube.com/watch?v=' + clip.v : ''),
        hasAn: !!an, anOpen, anToggle: () => this.setState({ vidAn: { ...st.vidAn, [s.id]: !anOpen } }),
        anBtn: anOpen ? '흐름 분석 접기 ▲' : (clip ? clip.label + ' ' : '') + '흐름 분석 보기 ▼',
        anUp, anDn, anGoals: goalMarks.map(g => ({ x: Math.min(1000, g.t / dur * 1000).toFixed(1), c: g.k === 'goal' ? '#D92D20' : '#141414' })),
        anTitle: (clip ? clip.label + ' ' : '') + '분석', anOwnW: (100 - anOpp) + '%', anOppW: anOpp + '%',
        anOwnTxt: '우리 진영 ' + Math.round(100 - anOpp) + '%', anOppTxt: '상대 진영 ' + Math.round(anOpp) + '%',
        anEnt: an ? an.ent + '회' : '', anAvg: an ? an.avg + '초' : '', anOppTime: an ? fmtSec(Math.round(dur * anOpp / 100)) : ''
      };
    };
    const vidOpenId = st.vidOpen === undefined || st.vidOpen === null ? (vidGames[0] && vidGames[0].id) : st.vidOpen;
    const vidRows = vidGames.map(s => {
      const open = s.id === vidOpenId;
      return { ...(open ? vidView(s) : { ...vidView(s), src: '', slotKey: '' }), open, onClick: () => this.setState({ vidOpen: open ? false : s.id }) };
    });
    const homeVid = st.tab === 'home' && vidGames[0] ? vidView(vidGames[0]) : null;
    const extraGoals = [goals.merc ? '용병 ' + goals.merc + '골' : '', goals.og ? '상대 자책골 ' + goals.og : '', goals.unk ? '득점자 미상 ' + goals.unk + '골' : ''].filter(Boolean).join(' · ');

    return {
      ui, tabs,
      showNotice: !!notice, notice: notice || {},
      homeReady: ready && st.tab === 'home' && !!next, fmReady: ready && st.tab === 'formation' && !!next,
      schedReady: ready && st.tab === 'schedule', membersReady: ready && st.tab === 'members',
      isAdmin,
      // 홈
      next: nextVals,
      mapOpen: st.mapOpen, mapLabel: st.mapOpen ? '지도 접기' : '지도 보기', toggleMap: () => this.setState(s => ({ mapOpen: !s.mapOpen })),
      noIdentity: !me, rsvpCollapsed, rsvpExpanded: !!(me && !rsvpCollapsed), myName: me ? me.name : '', rsvpButtons,
      myChip: myStatus ? { label: LABEL[myStatus], bg: PAL[myStatus][2], fg: PAL[myStatus][3] } : { label: '', bg: 'transparent', fg: '#141414' },
      openRsvp: () => this.setState({ rsvpEditing: true }),
      cnt, quorum, minPlayers: MIN_PLAYERS,
      bar: { attend: pct(cnt.attend, headcount), maybe: pct(cnt.maybe, headcount), absent: pct(cnt.absent, headcount), minPos: 'calc(' + Math.min(100, MIN_PLAYERS / (headcount || 1) * 100).toFixed(1) + '% - 1px)' },
      rosterOpen, rosterLabel: rosterOpen ? '명단 접기' : '명단 보기', toggleRoster: () => this.setState({ rosterOpen: !rosterOpen }), groups,
      guestFormOpen: !!st.guestForm, guestForm: st.guestForm || {},
      // 이름을 아직 안 골랐으면 이름 선택 창부터 연다
      openGuest: () => {
        if (!me) return this.setState({ pickerOpen: true });
        this.setState({ guestForm: { name: '', error: '' } });
        const input = el('gf-name');
        if (input) input.focus();
      },
      cancelGuest: () => this.setState({ guestForm: null }),
      saveGuest: () => this.addGuest(next),
      onGuestKey: e => { if (e.key === 'Enter') this.addGuest(next); },
      upcoming, upcomingEmpty: !upcoming.length,
      goFormation: go('formation'), goSchedule: go('schedule'), goHome: go('home'), goRecords: go('records'),
      recentGames, recentEmpty: !recentGames.length,
      // 포메이션
      mySummary, myQuarters, myLabel: me ? me.name + '님 포지션' : '내 포지션', qButtons, pitchSlots, qInfo, qHeads, lineupRows,
      formationEmpty: !fmReadyData, formationReady: fmReadyData,
      memberNote: !isAdmin && fmReadyData, benchList, editHint, saveBtn, fmError: st.fmError,
      emptyMsg: isAdmin ? '포메이션 만들기를 누르면 빈 자리에 참석자를 넣을 수 있어요.' : '운영진이 참석 인원을 확인하고 경기 전날까지 올려요. 올라오면 내 포지션이 맨 위에 바로 보여요.',
      startEdit: () => this.setState({ draft: range(qnOf(next)).map(() => SLOTS.map(s => [s, null])), draftFor: next.id, dirty: false, sel: null }),
      qCols: nq, qCellW: nq > 4 ? '38px' : '46px',
      // 쿼터 수 바꾸기(4 ↔ 6). 줄일 때 5·6쿼터에 배치가 있으면 확인
      qnLabel: nq === 4 ? '6쿼터로 바꾸기' : '4쿼터로 바꾸기',
      toggleQn: () => {
        const n2 = nq === 4 ? 6 : 4;
        const base = QE ? QE.map(q => q.map(x => x.slice())) : range(nq).map(() => SLOTS.map(s => [s, null]));
        if (n2 < nq && base.slice(n2).some(q => q.some(x => x[1] != null)) && !confirm('5·6쿼터 배치가 지워져요. 4쿼터로 바꿀까요?')) return;
        const cur = range(n2).map(i => base[i] || SLOTS.map(s => [s, null]));
        this.setState({ draft: cur, draftFor: next.id, dirty: true, sel: null, q: Math.min(st.q, n2 - 1), fmError: '' });
      },
      canCopyPrev: editing && qi > 0,
      copyPrev: () => setQ(c => { c[qi] = c[qi - 1].map(x => x.slice()); }),
      saveEdit: () => {
        if (!st.dirty || !draft) return;
        const quarters = draft.map(q => { const o = {}; q.forEach(([slot, id]) => { if (id != null) o[slot] = id; }); return o; });
        this.db.collection('hw_schedules').doc(next.id).update({ quarters, qn: quarters.length, updatedAt: Date.now() })
          .then(() => this.setState({ draft: null, draftFor: null, dirty: false, sel: null, savedAt: Date.now(), fmError: '' }))
          .catch(() => this.setState({ fmError: '저장하지 못했어요. 잠시 후 다시 눌러 주세요.' }));
      },
      // 일정
      schedGroups, schedViews, schedSub,
      schedEmpty: !schedGroups.length && !sf, schedEmptyText: isPast ? '지난 일정이 없어요.' : '등록된 예정 일정이 없어요.',
      schedFormOpen: !!sf, schedForm: sf ? { ...sf, saveLabel: sf.saving ? '저장 중...' : sf.saveLabel } : {},
      addSched: () => this.setState({ schedForm: { id: null, title: '일정 추가', saveLabel: '추가', date: '', time: '', venue: '', address: '', opponent: '', error: '' } }),
      cancelSched: () => this.setState({ schedForm: null }),
      resultFormOpen: !!st.resultForm, resultForm: st.resultForm ? { ...st.resultForm, hasPreview: st.resultForm.checked && st.resultForm.preview.length > 0, hasErrors: st.resultForm.errors.length > 0, hasWarnings: st.resultForm.warnings.length > 0, saveLabel: st.resultForm.saving ? '저장 중...' : '저장' } : {},
      cancelResult: () => this.setState({ resultForm: null }),
      checkResult: () => this.submitResult(false),
      saveResult: () => { if (!st.resultForm.saving) this.submitResult(true); },
      clearResult: () => {
        const f = st.resultForm;
        if (!confirm('이 경기 기록을 지울까요?')) return;
        this.db.collection('hw_schedules').doc(f.id).update({ result: firebase.firestore.FieldValue.delete(), updatedAt: Date.now() })
          .then(() => this.setState({ resultForm: null })).catch(() => alert('지우지 못했어요. 잠시 후 다시 눌러 주세요.'));
      },
      saveSched: () => { if (!sf.saving) this.saveSchedule(); },
      // 기록
      recordsReady: ready && st.tab === 'records',
      videoReady: ready && st.tab === 'video', vidRows, vidEmpty: !vidGames.length,
      homeVid: homeVid || {}, hasHomeVid: !!homeVid, noHomeVid: !homeVid, goVideo: go('video'),
      recYears: recYears.length > 1 ? recYears.map(y => ({ label: y, onClick: () => this.setState({ recYear: y, recOpen: null }), bg: y === recYear ? '#141414' : '#FFFFFF', fg: y === recYear ? '#FFFFFF' : '#141414', bd: y === recYear ? '#141414' : '#E2E1DC' })) : [],
      recSub: recYear + ' 시즌 · 결과는 경기 기록을 넣은 ' + played.length + '경기, 출석은 참석 응답이 있는 ' + attGames.length + '경기 기준',
      recCards: [
        { title: '경기', value: played.length, sub: wdl.w + '승 ' + wdl.d + '무 ' + wdl.l + '패' },
        { title: '득점', value: gf, sub: played.length ? '경기당 ' + (gf / played.length).toFixed(1) : '-' },
        { title: '실점', value: ga, sub: played.length ? '경기당 ' + (ga / played.length).toFixed(1) : '-' },
        { title: '평균 참석', value: avgAtt, sub: '용병 포함' }
      ],
      // 득점·출석 순위는 TOP5만 보이고 '전체 보기'로 펼친다
      scorerList: st.recAllGoals ? scorerList : scorerList.slice(0, 5), scorerEmpty: !scorerList.length, extraGoals, hasExtraGoals: !!extraGoals,
      goalMore: scorerList.length > 5, goalMoreLabel: st.recAllGoals ? '접기' : '전체 ' + scorerList.length + '명 보기', toggleGoalMore: () => this.setState({ recAllGoals: !st.recAllGoals }),
      attList: st.recAllAtt ? attAll : attAll.slice(0, 5), attEmpty: !attAll.length,
      attMore: attAll.length > 5, attMoreLabel: st.recAllAtt ? '접기' : '전체 ' + attAll.length + '명 보기', toggleAttMore: () => this.setState({ recAllAtt: !st.recAllAtt }),
      recGameRows, recGamesEmpty: !recGameRows.length,
      // 구성원
      memberTotal: sorted.length + '명',
      memberSub: (seasonPast.length ? '참석률은 ' + year + ' 시즌 출석 기록이 있는 ' + seasonPast.length + '경기 기준이에요.' : '참석률은 경기가 끝난 뒤부터 집계돼요.') + ' 왼쪽 포지션 칸을 누르면 바꿀 수 있어요.' + (isAdmin ? ' 이름을 누르면 수정할 수 있어요.' : ''),
      memberQuery: this.memberQuery,
      onMemberQuery: e => { this.memberQuery = e.target.value; filterByQuery('[data-member]', 'member', this.memberQuery, 'memberEmpty', 'grid'); },
      posFilters, memberRows, memberEmpty: String(!memberRows.some(r => r.display !== 'none')),
      memberFormOpen: !!mf, memberForm: mf || {},
      addMember: () => this.setState({ memberForm: { id: null, title: '구성원 추가', name: '', pos: 'MF', role: 'member', canDelete: false, error: '' } }),
      cancelMember: () => this.setState({ memberForm: null }),
      saveMember: () => this.saveMember(),
      deleteMember: () => {
        if (!confirm(mf.name + ' 님을 명단에서 뺄까요?')) return;
        this.writeRoster(this.members.filter(m => m.id !== mf.id), error => this.setState({ memberForm: { ...mf, error } }));
      },
      // 이름 선택 창
      pickerOpen: st.pickerOpen, pickList, pickEmpty: String(!pickList.length),
      openPicker: () => this.setState({ pickerOpen: true }),
      closePicker: () => { this.pendingRsvp = null; this.setState({ pickerOpen: false }); },
      pickerNote: this.pendingRsvp && this.pendingLabel() ? '이름을 고르면 ' + this.pendingLabel() + ' "' + LABEL[this.pendingRsvp.status] + '"이 바로 저장돼요.' : '',
      flash: st.flash, closeFlash: () => this.setState({ flash: '' }),
      canShare: (CFG.kakaoShareHosts || []).includes(location.hostname), shareKakao: () => this.shareToKakao(next),
      stop: e => e.stopPropagation(),
      onQuery: e => filterByQuery('[data-pick]', 'pick', e.target.value, 'pickEmpty', 'flex')
    };
  }
}

const hwarangApp = new HwarangApp();
hwarangApp.mount(document.getElementById('app'), document.getElementById('tpl'));
window.hwarangApp = hwarangApp;
