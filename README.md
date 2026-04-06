# hwarang

## Firebase 연동 (GCP project: `github-475723`)

현재 참석 데이터는 기본적으로 브라우저 로컬 저장소(localStorage)에 저장됩니다.
`config.local.js`에 Firebase 설정을 넣으면 참석 데이터가 Firestore와 동기화됩니다.

### 1) Firebase 프로젝트 준비
1. [Firebase Console](https://console.firebase.google.com/)에서 프로젝트 선택 또는 생성
   - 기존 GCP 프로젝트 `github-475723` 연결 가능
2. 프로젝트 설정 → **웹 앱 추가**
3. 발급된 Firebase SDK 설정값(`apiKey`, `appId`, `messagingSenderId` 등) 복사
4. Firestore Database 생성 (권장: 시작 모드 테스트 후 규칙 강화)

### 2) 로컬 설정 파일 생성
```bash
cp config.example.js config.local.js
```
`config.local.js`에서 `window.APP_CONFIG.FIREBASE_CONFIG` 값을 실제 발급값으로 채우세요.

### 3) Firestore 규칙(초기 테스트용 예시)
> 운영 전에는 인증 기반 규칙으로 강화하세요.

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /schedule_attendance/{docId} {
      allow read, write: if true;
    }
  }
}
```

### 4) 실행
정적 서버로 실행 후 참석 탭에서 체크하면 `schedule_attendance` 컬렉션에 저장됩니다.

- 문서 ID: `schedule.id` (예: `2026-04-11-2`)
- 필드: `attendees`, `month`, `day`, `location`, `updatedAt`

### 동작 방식
- Firebase 설정이 없으면: 로컬 저장만 사용
- Firebase 설정이 있으면:
  - 최초 로딩 시 Firestore 데이터 우선 병합
  - 클라우드가 비어있으면 현재 일정 데이터를 업로드
  - 참석 토글 시 Firestore에 즉시 반영
