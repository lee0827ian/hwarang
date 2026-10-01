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
  "kakaoJsKey": "47eed652b004605d8a8e3e39df268f24",
  // "카톡방에 참석 투표 올리기" 버튼을 보여 줄 주소. 지금은 테스트(미리보기) 주소에서만 켠다.
  // 운영에 열 때 "fchwarang.web.app"을 추가한다.
  "kakaoShareHosts": ["fchwarang--redesign-4z3l01vw.web.app"]
};
