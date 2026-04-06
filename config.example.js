// 민감 정보는 index.html에 하드코딩하지 말고, 이 파일을 복사해 config.local.js로 관리하세요.
// config.local.js는 .gitignore에 추가해서 저장소에 올라가지 않게 관리하는 것을 권장합니다.
window.APP_CONFIG = {
  GOOGLE_API_KEY: '',
  GOOGLE_CLIENT_ID: '',
  SPREADSHEET_ID: '',
  KAKAO_REST_API_KEY: 'firebase deploy --only hosting',
  KAKAO_JS_API_KEY: '47eed652b004605d8a8e3e39df268f24',
  ADMIN_PASSWORD: '1234',

  // Firebase (GCP project: github-475723)
  FIREBASE_SYNC_ENABLED: true,
  FIREBASE_ATTENDANCE_COLLECTION: 'schedule_attendance',
  FIREBASE_CONFIG: {
    apiKey: 'AIzaSyBWF-w9FY608WIWypndo4SlUpvo2yjBqEo',
    authDomain: 'github-475723.firebaseapp.com',
    projectId: 'github-475723',
    storageBucket: 'github-475723.appspot.com',
    messagingSenderId: '564267897779',
    appId: '1:564267897779:web:ed0d3a331bf6e1793b71c6',
    measurementId: "G-THSTJ2KCX6",
  },
};
