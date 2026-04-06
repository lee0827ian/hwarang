cat << 'EOF' > config.example.js
// 민감 정보는 index.html에 하드코딩하지 말고, 이 파일을 복사해 config.firebase.js로 관리하세요.
// config.firebase.js는 .gitignore에 추가해서 저장소에 올라가지 않게 관리하는 것을 권장합니다.
window.APP_CONFIG = {
  GOOGLE_API_KEY: '',
  GOOGLE_CLIENT_ID: '',
  SPREADSHEET_ID: '',
  KAKAO_REST_API_KEY: '',
  KAKAO_JS_API_KEY: '',
  ADMIN_PASSWORD: '1234',

  // Firebase (GCP project: fchwarang)
  FIREBASE_SYNC_ENABLED: true,
  FIREBASE_ATTENDANCE_COLLECTION: 'schedule_attendance',
  FIREBASE_CONFIG: {
    apiKey: '',
    authDomain: 'fchwarang.firebaseapp.com',
    projectId: 'fchwarang',
    storageBucket: 'fchwarang.appspot.com',
    messagingSenderId: '',
    appId: '',
  },
};
EOF
