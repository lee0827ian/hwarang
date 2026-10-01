# 화랑 FC

화랑 FC 사이트. 다음 경기, 참석 투표, 포메이션, 일정, 구성원을 보여 준다.

- 운영 주소: https://fchwarang.web.app (Firebase Hosting, 프로젝트 `fchwarang`)
- 화면 디자인: Claude Design "Hwarang Home.dc.html"을 옮긴 것

## 파일

| 파일 | 내용 |
|---|---|
| `index.html` | 화면 템플릿. `{{ 값 }}`, `<sc-for>`, `<sc-if>`, `on*`은 `renderer.js`가 해석한다 |
| `renderer.js` | 템플릿 해석기 |
| `app.js` | 화면 로직과 데이터 연결 |
| `config.js` | Firebase 웹 설정과 카카오 JavaScript 키. 브라우저에 공개되는 값만 둔다 |
| `firestore.rules` | Firestore 권한 규칙 |
| `assets/` | 로고 |

빌드 과정은 없다. 파일을 그대로 올리면 된다.

## 데이터 (Firestore)

- `hw_team/roster`: 구성원 명단. `members: [{ id, name, pos, admin }]`
- `hw_schedules/{일정}`: 일정 한 건. `date`, `time`, `venue`, `address`, `opponent`, `lat`, `lng`,
  참석 응답 `rsvp: { 구성원 id: attend | maybe | absent }`, 용병 `guests: { 용병 id: { name, by, at } }`,
  포메이션 `quarters: [{ 자리: 구성원 id 또는 용병 id } × 4쿼터]`

## 권한

로그인이 없다. 이름은 처음 한 번 명단에서 고르고 기기에 저장된다.
용병은 이름을 고른 사람이면 누구나 다음 경기에 추가할 수 있고, 빼는 것은 데려온 사람과 운영진만 한다.
명단에서 `admin`인 사람(운영진)에게만 포메이션 편집, 일정 추가·수정·삭제, 구성원 수정 버튼이 보인다.
지금은 서버 규칙이 열려 있어 화면 밖에서도 쓸 수 있다. 운영진 비밀번호를 도입하면 규칙을 좁힌다.

## 배포

Firebase Hosting에 `index.html`, `app.js`, `renderer.js`, `config.js`, `assets/`, `404.html`만 올린다.
`.git` 폴더나 문서 파일은 올리지 않는다.
