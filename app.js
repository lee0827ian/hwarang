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
window.parseQuarterLog = parseQuarterLog;

// 기기 시간대 기준 오늘 날짜(YYYY-MM-DD)
const localDate = () => { const n = new Date(); return new Date(n - n.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
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
    if (!s || s.date < localDate()) {
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
    const p = parseQuarterLog(text, this.members || []);
    const T = p.total;
    const preview = T ? ['쿼터별 점수 없이 합계만' + (T.qn ? ' (' + T.qn + '쿼터)' : '') + (T.names.length ? '  (' + T.names.join(', ') + ')' : '')]
      : p.qs.map((q, i) => (i + 1) + '쿼터  ' + q.our + ' : ' + q.their + (q.names.length ? '  (' + q.names.join(', ') + ')' : ''));
    const our = T ? T.our : p.qs.reduce((x, q) => x + q.our, 0), their = T ? T.their : p.qs.reduce((x, q) => x + q.their, 0);
    const next = { ...f, text, preview, errors: p.errors, warnings: p.warnings, total: (p.qs.length || T) ? '합계 ' + our + ' : ' + their + ' (' + (our > their ? '승' : our < their ? '패' : '무') + ')' : '', checked: true };
    if (!save || p.errors.length) { this.setState({ resultForm: { ...next, error: save && p.errors.length ? '빨간 줄을 고친 뒤 다시 저장해 주세요.' : '' } }); return; }
    this.setState({ resultForm: { ...next, saving: true, error: '' } });
    const result = T ? { qs: [], sc: T.sc, qn: T.qn, our, their, at: Date.now(), by: this.state.me || null }
      : { qs: p.qs.map(q => ({ our: q.our, their: q.their, sc: q.sc })), our, their, at: Date.now(), by: this.state.me || null };
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
    }).then(() => this.setState({ schedForm: null, schedSel: ref.id, schedView: data.date >= localDate() ? 'upcoming' : 'past' }))
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

    const today = localDate();
    const upcomingAll = schedules.filter(s => s.date >= today);
    const pastAll = schedules.filter(s => s.date < today).reverse();
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
      return s.date < today ? '상대 미기록' : '상대 미정';
    };

    // 탭
    const go = k => () => { this.setState({ tab: k }); window.scrollTo(0, 0); };
    const tabs = [['home', '홈'], ['formation', '포메이션'], ['schedule', '일정'], ['records', '기록'], ['members', '구성원']].map(([k, l]) => {
      const on = st.tab === k;
      return { label: l, onClick: go(k), color: on ? '#141414' : '#6B6B6B', weight: on ? 800 : 600, bar: on ? '#C71F10' : 'transparent' };
    });
    const ui = mob
      ? { headPad: '10px 16px', logo: '38px', title: '18px', topTabs: 'none', bottomTabs: 'flex', bottomPad: '84px', mainPad: '14px 12px 0', gap: '10px', cardPad: '16px', homeCols: 'minmax(0,1fr)', homeAreas: '"a" "f" "u"', heroDate: '34px', mapH: '160px', groupCols: 'minmax(0,1fr)', groupGap: '6px', pitchMaxHome: '100%', pitchMaxTab: '100%', fmCols: 'minmax(0,1fr)', pageTitle: '22px', schedCols: 'minmax(0,1fr)', listPad: '8px 12px', memberCols: 'minmax(0,1fr)', searchW: '100%', formCols: 'minmax(0,1fr)', formCols3: 'minmax(0,1fr)' }
      : { headPad: '0 32px', logo: '44px', title: '20px', topTabs: 'flex', bottomTabs: 'none', bottomPad: '48px', mainPad: '28px 32px 0', gap: '16px', cardPad: '20px 22px', homeCols: 'minmax(0,1fr) minmax(0,440px)', homeAreas: '"a f" "u f"', heroDate: '40px', mapH: '240px', groupCols: '64px minmax(0,1fr)', groupGap: '10px', pitchMaxHome: '100%', pitchMaxTab: '460px', fmCols: 'minmax(0,1.05fr) minmax(0,1fr)', pageTitle: '26px', schedCols: 'repeat(2, minmax(0,1fr))', listPad: '10px 16px', memberCols: 'repeat(2, minmax(0,1fr))', searchW: '260px', formCols: 'repeat(2, minmax(0,1fr))', formCols3: 'repeat(3, minmax(0,1fr))' };

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
        onClick: () => { if (next) this.setRsvp(next.id, k); this.setState({ rsvpEditing: false }); } };
    });
    const rsvpCollapsed = !!(me && myStatus && !st.rsvpEditing);
    const rosterOpen = st.rosterOpen == null ? !mob : st.rosterOpen;
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
          hasScorers: Object.keys(scorerTotals).length > 0
        } : {},
        canRecord: isAdmin && s.date <= today, recordLabel: res ? '경기 기록 수정' : '경기 기록 입력',
        onRecord: () => {
          const nm = k => (k === 'merc' ? '용병' : k === 'og' ? '자책골' : k === 'unk' ? '미상' : (byId[k] ? byId[k].name : '?'));
          const scTxt = sc => (Object.keys(sc || {}).length ? ' (' + Object.entries(sc).map(([k, n]) => nm(k) + (n > 1 ? n : '')).join(', ') + ')' : '');
          const txt = res && !resQs.length ? (res.qn ? range(res.qn).map(i => i + 1).join(',') + '쿼터 ' : '합계 ') + res.our + ' : ' + res.their + scTxt(res.sc) : res ? res.qs.map((q, i) => (i + 1) + '쿼터 - ' + q.our + ' : ' + q.their + (Object.keys(q.sc || {}).length ? ' (' + Object.entries(q.sc).map(([k, n]) => nm(k) + (n > 1 ? n : '')).join(', ') + ')' : '')).join('\n') : '';
          this.setState({ resultForm: { id: s.id, title: p.md + ' ' + (s.opponent ? 'vs ' + s.opponent : s.venue || '') + ' 경기 기록', text: txt, hasExisting: !!res, preview: [], errors: [], warnings: [], total: '', error: '', checked: false } });
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
    // 시즌 골: 올해 경기 기록(result)의 득점자 합계
    const seasonGoals = {};
    schedules.filter(s => s.date.slice(0, 4) === year && resultOf(s))
      .forEach(s => Object.entries(scorersOf(s.result)).forEach(([k, n]) => { seasonGoals[k] = (seasonGoals[k] || 0) + n; }));
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
      const s = statusOf(next, m.id);
      return { name: isMe ? m.name + ' (나)' : m.name, key: keyOf(m), pos: m.pos || '-',
        sub: [next ? '이번 경기 ' + (s ? LABEL[s] : '미응답') : '', seasonPast.length ? '참석 ' + att + '/' + seasonPast.length : '', seasonGoals[m.id] ? year + ' 시즌 ' + seasonGoals[m.id] + '골' : ''].filter(Boolean).join(' · '),
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
        noAttend: !t.attend.length && !gs.length
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
