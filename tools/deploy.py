# Firebase Hosting REST 배포. 기본은 미리보기 채널(운영 사이트는 건드리지 않음).
# 사용: python tools/deploy.py <토큰> [채널이름]     채널이름 생략 시 redesign. "live"를 주면 운영에 배포한다.
# 토큰: gcloud auth print-access-token --account <프로젝트 소유 계정>
import sys, io, os, json, gzip, hashlib, urllib.request, urllib.error
try:
    import truststore; truststore.inject_into_ssl()
except Exception: pass
TOKEN = sys.argv[1]
CHANNEL = sys.argv[2] if len(sys.argv) > 2 else 'redesign'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace('\\', '/') + '/'   # 저장소 폴더
FILES = ['index.html', 'app.js', 'renderer.js', 'config.js', 'assets/hwarang-logo.svg', 'assets/hwarang-crest.png', '404.html']   # 이것만 올린다(.git, 문서, 예전 파일 제외)
API = 'https://firebasehosting.googleapis.com/v1beta1/'
SITE = 'sites/fchwarang'
def call(method, url, body=None, raw=None, ctype='application/json'):
    data = raw if raw is not None else (json.dumps(body).encode('utf-8') if body is not None else None)
    req = urllib.request.Request(url, method=method, data=data, headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': ctype, 'x-goog-user-project': 'fchwarang'})
    try:
        r = urllib.request.urlopen(req, timeout=60); t = r.read().decode('utf-8')
        return r.status, (json.loads(t) if t.strip().startswith('{') else t)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')[:400]

blobs = {}
for f in FILES:
    gz = gzip.compress(io.open(REPO + f, 'rb').read(), mtime=0)
    blobs['/' + f] = (hashlib.sha256(gz).hexdigest(), gz)
s, v = call('POST', API + SITE + '/versions', {'config': {'headers': [{'glob': '**', 'headers': {'Cache-Control': 'no-cache'}}]}})
assert s == 200, (s, v)
version = v['name']; print('버전 생성:', version.split('/')[-1])
s, p = call('POST', API + version + ':populateFiles', {'files': {path: h for path, (h, _) in blobs.items()}})
assert s == 200, (s, p)
need = set(p.get('uploadRequiredHashes', []))
for path, (h, gz) in blobs.items():
    if h in need:
        s2, r2 = call('POST', p['uploadUrl'] + '/' + h, raw=gz, ctype='application/octet-stream')
        assert s2 == 200, (path, s2, r2)
print('파일 %d개 중 %d개 업로드' % (len(blobs), len(need)))
s, f = call('PATCH', API + version + '?update_mask=status', {'status': 'FINALIZED'})
assert s == 200 and f.get('status') == 'FINALIZED', (s, f)
if CHANNEL == 'live':
    s, rel = call('POST', API + SITE + '/releases?versionName=' + version, {'message': 'redesign'})
    assert s == 200, (s, rel)
    print('운영 배포 완료: https://fchwarang.web.app')
else:
    s, ch = call('GET', API + SITE + '/channels/' + CHANNEL)
    if s == 404:
        s, ch = call('POST', API + SITE + '/channels?channelId=' + CHANNEL, {'ttl': '2592000s'})
    assert s == 200, (s, ch)
    s, rel = call('POST', API + SITE + '/channels/' + CHANNEL + '/releases?versionName=' + version, {'message': 'redesign preview'})
    assert s == 200, (s, rel)
    s, ch = call('GET', API + SITE + '/channels/' + CHANNEL)
    print('미리보기 배포 완료:', ch.get('url'), '· 만료', str(ch.get('expireTime'))[:10])
