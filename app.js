// 화랑 FC 사이트 — app.js
// Claude Design "Hwarang Home.dc.html"의 화면 로직을 실제 데이터(Firestore)에 연결한 것.
// 상태나 데이터가 바뀌면 renderVals() → 템플릿 전체를 다시 그린다(#app). 해석기는 renderer.js.
//
// 데이터 (Firestore)
//   hw_team/roster        { members: [{ id, name, pos: 'GK'|'DF'|'MF'|'FW', admin }] }
//   hw_schedules/{id}     { date: 'YYYY-MM-DD', time, venue, address, opponent, lat, lng,
//                           rsvp: { [구성원 id]: 'attend'|'maybe'|'absent' },
//                           quarters: [{ [자리]: 구성원 id } × 4쿼터] }

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
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CFG.kakaoJsKey}&autoload=false&libraries=services`;
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

// ── 카카오 JS SDK(카카오내비 실행). 지도 SDK와 별개(window.Kakao) ──
let kakaoSdkReady = null;
function loadKakaoSdk() {
  if (kakaoSdkReady) return kakaoSdkReady;
  kakaoSdkReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.3/kakao.min.js';
    s.integrity = 'sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy';
    s.crossOrigin = 'anonymous';
    s.onload = () => { if (!window.Kakao.isInitialized()) window.Kakao.init(CFG.kakaoJsKey); resolve(); };
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
    const where = s.address || name;
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
    this.state = {
      tab: 'home', me, q: 0,
      pickerOpen: false, rsvpEditing: false, mapOpen: false, rosterOpen: null,
      draft: null, draftFor: null, sel: null, dirty: false, savedAt: 0, fmError: '',
      schedView: 'upcoming', schedSel: undefined, schedForm: null,
      memberPos: 'all', memberForm: null,
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
  dataChanged() { if (this.state.pickerOpen || this.state.schedForm || this.state.memberForm) return; this.render(); }

  // ── 쓰기 ──
  setRsvp(scheduleId, status) {
    const me = this.state.me;
    if (!me) return;
    this.db.collection('hw_schedules').doc(scheduleId).update({ ['rsvp.' + me]: status, updatedAt: Date.now() })
      .catch(() => alert('저장하지 못했어요. 잠시 후 다시 눌러 주세요.'));
  }
  // 문서의 쿼터 배치 → 편집용 [[자리, 구성원 id 또는 null] × 11] × 4. 저장된 것이 없으면 null
  quartersOf(s) {
    const q = s && s.quarters;
    if (!Array.isArray(q) || !q.length) return null;
    return [0, 1, 2, 3].map(i => SLOTS.map(slot => [slot, q[i] && q[i][slot] != null ? q[i][slot] : null]));
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
    const nameOf = id => (byId[id] ? byId[id].name : '');
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
    const matchLabel = s => (s.opponent ? 'vs ' + s.opponent : '자체 경기');

    // 탭
    const go = k => () => { this.setState({ tab: k }); window.scrollTo(0, 0); };
    const tabs = [['home', '홈'], ['formation', '포메이션'], ['schedule', '일정'], ['members', '구성원']].map(([k, l]) => {
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
      onClick: () => { try { localStorage.setItem('hwarang_me', m.id); } catch (e) {} this.setState({ me: m.id, pickerOpen: false, rsvpEditing: true }); }
    }));

    // ── 다가오는 경기 · 내 참석 · 참석 현황 ──
    const g = tally(next);
    const cnt = { attend: g.attend.length, maybe: g.maybe.length, absent: g.absent.length, none: g.none.length, total: sorted.length };
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
      return m === me ? { name: m.name, bg: '#141414', fg: '#FFFFFF', weight: 800, bd: '#141414' }
        : { name: m.name, bg: p[0], fg: p[1], weight: 600, bd: k ? 'transparent' : '#E2E1DC' };
    };
    const meFirst = list => [...list].sort((a, b) => (b === me) - (a === me));
    const groups = [['attend', '참석', '#A3190B'], ['maybe', '미정', '#6E5513'], ['absent', '불참', '#4F4F4F'], ['none', '미응답', '#5F5F5F']].map(([k, l, c]) => {
      const list = meFirst(g[k]);
      return { label: l, color: c, n: list.length, names: list.map(m => chip(m, k === 'none' ? null : k)) };
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
    const fmReadyData = !!QE && QE.some(q => q.some(x => x[1] != null));
    const editing = isAdmin && !!QE;
    const setQ = fn => this.setState(() => {
      const cur = QE.map(q => q.map(x => x.slice()));
      fn(cur);
      return { draft: cur, draftFor: next.id, sel: null, dirty: true, fmError: '' };
    });
    const posOf = (id, qi) => { if (!QE) return null; const f = QE[qi].find(x => x[1] === id); return f ? posName(f[0]) : null; };
    const slots = QE ? QE[st.q] : SLOTS.map(s => [s, null]);
    const sel = st.sel;
    const clickSlot = idx => () => {
      if (!editing) return;
      if (sel && sel.kind === 'slot' && sel.idx === idx) return this.setState({ sel: null });
      if (sel && sel.kind === 'slot') return setQ(c => { const a = c[st.q]; const t = a[idx][1]; a[idx][1] = a[sel.idx][1]; a[sel.idx][1] = t; });
      if (sel && sel.kind === 'bench') return setQ(c => { c[st.q][idx][1] = sel.id; });
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
    const myPos = [0, 1, 2, 3].map(i => (me && fmReadyData ? posOf(meId, i) : null));
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
    const myQuarters = [0, 1, 2, 3].map(i => {
      const p = myPos[i];
      return { q: (i + 1) + '쿼터', pos: p || (fmReadyData && me ? '휴식' : '-'), bg: p ? '#C71F10' : '#F6F6F4', fg: p ? '#FFFFFF' : '#5F5F5F', sub: p ? '#F3DFA0' : '#6B6B6B' };
    });
    const qButtons = [0, 1, 2, 3].map(i => {
      const on = st.q === i;
      return { label: (i + 1) + '쿼터', onClick: () => this.setState({ q: i, sel: null }), bg: on ? '#141414' : '#FFFFFF', fg: on ? '#FFFFFF' : '#141414', bd: on ? '#141414' : '#E2E1DC', dot: myPos[i] ? '#E53B1F' : 'transparent' };
    });
    const attendIds = g.attend.map(m => m.id);
    const restIds = attendIds.filter(id => !posOf(id, st.q));
    const filled = slots.filter(x => x[1] != null).length;
    const qInfo = QE ? { field: (st.q + 1) + '쿼터 휴식 ' + restIds.length + '명', rest: '필드 ' + filled + '/11' } : { field: '4-2-3-1 · 11명', rest: '배치 전' };
    const benchList = (QE ? restIds : []).map(id => {
      const isSel = editing && sel && sel.kind === 'bench' && sel.id === id;
      const isMe = id === meId;
      return { name: nameOf(id), h: editing ? '40px' : '32px', cursor: editing ? 'pointer' : 'default',
        bg: isSel ? '#D8C07A' : (isMe ? '#141414' : '#F3F3F0'), fg: isSel ? '#141414' : (isMe ? '#FFFFFF' : '#141414'),
        bd: isSel ? '#D8C07A' : (editing ? '#D8D7D0' : 'transparent'), bdStyle: editing && !isSel ? 'dashed' : 'solid',
        onClick: () => {
          if (!editing) return;
          if (isSel) return this.setState({ sel: null });
          if (sel && sel.kind === 'slot') return setQ(c => { c[st.q][sel.idx][1] = id; });
          this.setState({ sel: { kind: 'bench', id } });
        } };
    });
    // 선수가 들어 있는 자리를 골랐을 때만: 그 자리를 비우는 버튼
    if (editing && sel && sel.kind === 'slot' && slots[sel.idx][1] != null) {
      benchList.push({ name: '이 자리 비우기', h: '40px', cursor: 'pointer', bg: '#FFFFFF', fg: '#A3190B', bd: '#E8B4AD', bdStyle: 'solid', onClick: () => setQ(c => { c[st.q][sel.idx][1] = null; }) });
    }
    const editHint = sel ? (sel.kind === 'bench' ? nameOf(sel.id) + ' 선택됨 · 넣을 자리를 누르세요' : '선택됨 · 바꿀 선수나 휴식 인원을 누르세요') : '선수를 눌러 선택한 뒤, 다른 자리나 휴식 인원을 누르면 바뀌어요';
    const saveBtn = st.dirty ? { label: '저장', bg: '#C71F10', fg: '#FFFFFF' } : { label: st.savedAt ? '저장됨' : '변경 없음', bg: '#FFFFFF', fg: '#6B6B6B' };
    const qHeads = [0, 1, 2, 3].map(i => ({ label: (i + 1) + 'Q', fg: st.q === i ? '#C71F10' : '#5F5F5F' }));
    // 출전표: 참석자 + (참석이 아니어도) 배치된 사람
    const placedIds = QE ? [...new Set(QE.flatMap(q => q.map(x => x[1]).filter(id => id != null)))] : [];
    const lineupMembers = meFirst(sorted.filter(m => attendIds.includes(m.id) || placedIds.includes(m.id)));
    const lineupRows = lineupMembers.map(m => {
      const isMe = m === me;
      const ps = [0, 1, 2, 3].map(i => posOf(m.id, i));
      return {
        name: isMe ? m.name + ' (나)' : m.name, weight: isMe ? 800 : 600, fg: isMe ? '#A3190B' : '#141414', bg: isMe ? '#FBE9E6' : 'transparent', radius: isMe ? '8px' : '0',
        count: ps.filter(Boolean).length + '/4',
        cells: ps.map((p, i) => ({ text: p || '휴식', size: p ? '13px' : '12px', weight: p ? 800 : 600, fg: p ? (isMe ? '#FFFFFF' : '#141414') : '#8A8A85', bg: p ? (isMe ? '#C71F10' : (st.q === i ? '#F6F0DC' : '#F3F3F0')) : 'transparent' }))
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
      const a = t.attend.length, m2 = t.maybe.length, x = t.absent.length, total = sorted.length;
      const apps = open ? navLinks(s) : [];
      const pastChip = mine === 'attend' ? { chip: '출석', chipBg: '#141414', chipFg: '#FFFFFF', chipBd: 'transparent' } : { chip: '결석', chipBg: '#F0F0EC', chipFg: '#4F4F4F', chipBd: 'transparent' };
      return {
        ...(isPast ? (me ? pastChip : { chip: '참석 ' + a, chipBg: '#F0F0EC', chipFg: '#4F4F4F', chipBd: 'transparent' }) : chipFor(mine)),
        monthLabel: p.month, date: p.md, dow: p.dow + '요일', venue: s.venue || '구장 미정', address: s.address || '',
        isNext: !isPast && next && s.id === next.id, dday: ddayOf(s), dateFg: isPast ? '#6B6B6B' : '#141414',
        meta: [s.time, matchLabel(s), '참석 ' + a + '명'].filter(Boolean).join(' · '),
        open, onClick: () => this.setState({ schedSel: open ? null : s.id }),
        a, m: m2, x, none: t.none.length, barA: pct(a, total), barM: pct(m2, total), barX: pct(x, total),
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
      ? '지난 일정 ' + pastAll.length + '경기' + (me ? ' · 내 출석 ' + pastAll.filter(s => statusOf(s, meId) === 'attend').length + '회' : '')
      : (me ? '예정 ' + upcomingAll.length + '경기 중 ' + answeredN + '경기 응답했어요. 미리 응답해 두면 운영진이 인원 파악하기 쉬워요.' : '이름을 선택하면 일정별로 미리 응답할 수 있어요.');
    const sf = st.schedForm;

    // ── 구성원 탭 ──
    const year = today.slice(0, 4);
    const seasonPast = pastAll.filter(s => s.date.slice(0, 4) === year);
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
      return { name: (isMe ? m.name + ' (나)' : m.name) + (m.admin ? ' · 운영진' : ''), key: keyOf(m), pos: m.pos || '-',
        sub: [next ? '이번 경기 ' + (s ? LABEL[s] : '미응답') : '', seasonPast.length ? '참석 ' + att + '/' + seasonPast.length : ''].filter(Boolean).join(' · '),
        rate, display: !mq || keyOf(m).includes(mq) ? 'grid' : 'none',
        weight: isMe ? 800 : 700, fg: isMe ? '#A3190B' : '#141414', bg: isMe ? '#FBE9E6' : 'transparent', radius: isMe ? '10px' : '0',
        posBg: m.pos === 'GK' ? '#F6F0DC' : '#F3F3F0', posFg: m.pos === 'GK' ? '#6E5513' : '#141414', barFg: seasonPast.length && att / seasonPast.length >= 0.7 ? '#C71F10' : '#A8A8A2',
        cursor: isAdmin ? 'pointer' : 'default',
        onClick: () => { if (isAdmin) { this.setState({ memberForm: { id: m.id, title: m.name + ' 수정', name: m.name, pos: m.pos || 'MF', role: m.admin ? 'admin' : 'member', canDelete: true, error: '' } }); window.scrollTo(0, 0); } } };
    });
    const mf = st.memberForm;

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
      bar: { attend: pct(cnt.attend, cnt.total), maybe: pct(cnt.maybe, cnt.total), absent: pct(cnt.absent, cnt.total), minPos: 'calc(' + Math.min(100, MIN_PLAYERS / (cnt.total || 1) * 100).toFixed(1) + '% - 1px)' },
      rosterOpen, rosterLabel: rosterOpen ? '명단 접기' : '명단 보기', toggleRoster: () => this.setState({ rosterOpen: !rosterOpen }), groups,
      upcoming, upcomingEmpty: !upcoming.length,
      goFormation: go('formation'), goSchedule: go('schedule'),
      // 포메이션
      mySummary, myQuarters, myLabel: me ? me.name + '님 포지션' : '내 포지션', qButtons, pitchSlots, qInfo, qHeads, lineupRows,
      formationEmpty: !fmReadyData, formationReady: fmReadyData,
      memberNote: !isAdmin && fmReadyData, benchList, editHint, saveBtn, fmError: st.fmError,
      emptyMsg: isAdmin ? '포메이션 만들기를 누르면 빈 자리에 참석자를 넣을 수 있어요.' : '운영진이 참석 인원을 확인하고 경기 전날까지 올려요. 올라오면 내 포지션이 맨 위에 바로 보여요.',
      startEdit: () => this.setState({ draft: [0, 1, 2, 3].map(() => SLOTS.map(s => [s, null])), draftFor: next.id, dirty: false, sel: null }),
      canCopyPrev: editing && st.q > 0,
      copyPrev: () => setQ(c => { c[st.q] = c[st.q - 1].map(x => x.slice()); }),
      saveEdit: () => {
        if (!st.dirty || !draft) return;
        const quarters = draft.map(q => { const o = {}; q.forEach(([slot, id]) => { if (id != null) o[slot] = id; }); return o; });
        this.db.collection('hw_schedules').doc(next.id).update({ quarters, updatedAt: Date.now() })
          .then(() => this.setState({ draft: null, draftFor: null, dirty: false, sel: null, savedAt: Date.now(), fmError: '' }))
          .catch(() => this.setState({ fmError: '저장하지 못했어요. 잠시 후 다시 눌러 주세요.' }));
      },
      // 일정
      schedGroups, schedViews, schedSub,
      schedEmpty: !schedGroups.length && !sf, schedEmptyText: isPast ? '지난 일정이 없어요.' : '등록된 예정 일정이 없어요.',
      schedFormOpen: !!sf, schedForm: sf ? { ...sf, saveLabel: sf.saving ? '저장 중...' : sf.saveLabel } : {},
      addSched: () => this.setState({ schedForm: { id: null, title: '일정 추가', saveLabel: '추가', date: '', time: '', venue: '', address: '', opponent: '', error: '' } }),
      cancelSched: () => this.setState({ schedForm: null }),
      saveSched: () => { if (!sf.saving) this.saveSchedule(); },
      // 구성원
      memberTotal: sorted.length + '명',
      memberSub: seasonPast.length ? '참석률은 ' + year + ' 시즌 지난 일정 ' + seasonPast.length + '경기 기준이에요.' : '참석률은 경기가 끝난 뒤부터 집계돼요.' + (isAdmin ? ' 이름을 누르면 수정할 수 있어요.' : ''),
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
      closePicker: () => this.setState({ pickerOpen: false }),
      stop: e => e.stopPropagation(),
      onQuery: e => filterByQuery('[data-pick]', 'pick', e.target.value, 'pickEmpty', 'flex')
    };
  }
}

const hwarangApp = new HwarangApp();
hwarangApp.mount(document.getElementById('app'), document.getElementById('tpl'));
window.hwarangApp = hwarangApp;
