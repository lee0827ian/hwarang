// 화랑 FC 사이트 설정. 여기 값은 브라우저에 공개되는 값이다(Firebase 웹 설정, 카카오 JavaScript 키).
// 비밀 값(관리자 비밀번호, REST 키 등)은 넣지 않는다.
window.HWARANG_CONFIG = {
  "firebase": {
    "apiKey": "AIzaSyDc87OkYorY1pZWKBFQOs__Wo3Ares_4ps",
    "authDomain": "fchwarang.firebaseapp.com",
    "projectId": "fchwarang",
    "storageBucket": "fchwarang.firebasestorage.app",
    "messagingSenderId": "620103429577",
    "appId": "1:620103429577:web:ad4598638b6a10ecb20c18"
  },
  // 카카오 JavaScript 키는 두 개를 쓴다.
  // 지도: "휘슬_STAT관리" 앱의 키. 카카오맵 무료 사용량은 계정의 첫 앱에만 주어져서 지도는 이 앱을 같이 쓴다.
  "kakaoMapKey": "47eed652b004605d8a8e3e39df268f24",
  // 카톡 공유 · 카카오내비: "화랑_매치" 앱(ID 1594176)의 키. 공유 카드에 이 앱 이름이 찍히고, 링크도 이 앱에 등록된 주소로 열린다.
  "kakaoAppKey": "f956dcd4bda6ac4ed033505d8ba3a3e3",
  // "카톡방에 참석 투표 올리기" 버튼을 보여 줄 주소(운영, 테스트). 화랑_매치 앱에 등록된 주소만 적는다.
  "kakaoShareHosts": ["fchwarang.web.app", "fchwarang--redesign-4z3l01vw.web.app"]
};
