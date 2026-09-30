
import hashlib, http.client, json, os, re, subprocess
from pathlib import Path

root = Path('/root/partsignal')
rid = 'preview-20260929-082104-4e85aaf9'
old = 'mvp-20260928-023635-649641cec3bd'

def call(args):
    p = subprocess.run(args, capture_output=True, text=True, check=True)
    return p.stdout.strip()

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

source_headers = root / 'releases' / rid / 'deploy/nginx/partsignal-security-headers.conf'
host_headers = Path('/etc/nginx/snippets/partsignal-security-headers.conf')
assert source_headers.read_bytes() == host_headers.read_bytes(), 'security snippet drift'
expected = {}
for line in source_headers.read_text().splitlines():
    match = re.fullmatch(r'add_header\s+([A-Za-z-]+)\s+(?:"([^"]+)"|(\S+))\s+always;', line)
    assert match is not None, 'security snippet parse'
    expected[match.group(1).lower()] = match.group(2) or match.group(3)
assert len(expected) == 6, 'security header count'

def public(path):
    conn = http.client.HTTPSConnection('geo.962850.xyz', timeout=10)
    try:
        conn.request('GET', path)
        response = conn.getresponse()
        body = response.read(2_000_001)
        headers = response.getheaders()
        exact = all([value for key, value in headers if key.lower() == name] == [value] for name, value in expected.items())
        return {'status': response.status, 'security_headers_exact': exact, 'bytes': len(body)}, body
    finally:
        conn.close()

root_http, homepage = public('/')
match = re.search(rb'<script[^>]+src="(/assets/[^" ]+\.js)"', homepage)
asset_http, _ = public(match.group(1).decode('ascii')) if match else ({'status': 0, 'security_headers_exact': False, 'bytes': 0}, b'')
live_http, live_body = public('/api/health/live')
ready_http, ready_body = public('/api/health/ready')
live = json.loads(live_body)
ready = json.loads(ready_body)

project_ids = call(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=partsignal-staging']).splitlines()
project = []
for item in json.loads(call(['docker', 'inspect', *project_ids])):
    state = item['State']
    labels = item['Config'].get('Labels') or {}
    project.append({'id': item['Id'], 'service': labels.get('com.docker.compose.service'),
                    'running': state['Running'], 'health': (state.get('Health') or {}).get('Status'),
                    'restart_count': item.get('RestartCount', 0), 'oom': state.get('OOMKilled', False),
                    'oneoff': labels.get('com.docker.compose.oneoff'), 'image': item['Image']})
network_ids = call(['docker', 'network', 'ls', '-q', '--filter', 'label=com.docker.compose.project=partsignal-staging']).splitlines()
networks = []
for item in json.loads(call(['docker', 'network', 'inspect', *network_ids])):
    labels = item.get('Labels') or {}
    networks.append({'id': item['Id'], 'name': item['Name'], 'project': labels.get('com.docker.compose.project'),
                     'logical': labels.get('com.docker.compose.network'), 'internal': item['Internal']})
other_ids = [item for item in call(['docker', 'ps', '-aq']).splitlines() if item not in project_ids]
other = []
for item in json.loads(call(['docker', 'inspect', *other_ids])):
    state = item['State']
    other.append({'id': item['Id'], 'running': state['Running'], 'restart_count': item.get('RestartCount', 0),
                  'oom': state.get('OOMKilled', False), 'started_at': state.get('StartedAt')})

images = {}
for name in ('partsignal-backend:' + old, 'partsignal-frontend:' + old):
    inspected = json.loads(call(['docker', 'image', 'inspect', name]))[0]
    images[name] = {'id': inspected['Id'], 'repo_digests': inspected.get('RepoDigests') or []}

result = {
    'utc': call(['date', '-u', '+%Y-%m-%dT%H:%M:%SZ']),
    'release_id': rid,
    'current_target': os.readlink(root / 'current'),
    'release_directory_exists': (root / 'releases' / rid).is_dir(),
    'archive_sha': sha(root / 'releases' / (rid + '.tar.gz')),
    'old_release_directory_exists': (root / 'releases' / old).is_dir(),
    'old_archive_sha': sha(root / 'releases' / (old + '.tar.gz')),
    'old_manifest_sha': sha(root / 'releases' / (old + '.manifest.json')),
    'historical_images': images,
    'site_sha': sha('/etc/nginx/sites-available/partsignal-staging.conf'),
    'site_enabled_target': os.readlink('/etc/nginx/sites-enabled/partsignal-staging.conf'),
    'pending_marker': (root / 'shared' / ('.preview-nginx-activation-' + rid + '.pending')).exists(),
    'nginx_test_exit': subprocess.run(['nginx', '-t'], capture_output=True).returncode,
    'project': sorted(project, key=lambda item: item['service'] or ''),
    'networks': sorted(networks, key=lambda item: item['name']),
    'other': sorted(other, key=lambda item: item['id']),
    'http': {'root': root_http, 'asset': asset_http, 'live': live_http, 'ready': ready_http},
    'health': {'live_status': live.get('status'), 'ready_status': ready.get('status'),
               'ready_checks': ready.get('checks')},
}
import stat
p=root/'shared/.env.staging';s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600
raw=p.read_bytes();assert raw.count(b'CONTENT_GENERATOR=deterministic\n')==1
candidate=raw.replace(b'CONTENT_GENERATOR=deterministic\n',b'CONTENT_GENERATOR=openai-compatible\n')
result['env']={'bytes':len(raw),'sha256':sha(p),'uid':s.st_uid,'gid':s.st_gid,'mode':oct(stat.S_IMODE(s.st_mode)),'candidate_bytes':len(candidate),'candidate_sha256':hashlib.sha256(candidate).hexdigest()}
result['pending_any']=list(str(x) for x in (root/'shared').rglob('*.pending'))
result['data']=[{'path':str(p),'device':p.stat().st_dev,'inode':p.stat().st_ino,'uid':p.stat().st_uid,'gid':p.stat().st_gid,'mode':oct(stat.S_IMODE(p.stat().st_mode))} for p in map(Path,['/root/partsignal-data/postgres','/root/partsignal-data/redis','/root/partsignal-data/objects'])]
result['nginx_full_sha']=hashlib.sha256(call(['nginx','-T']).encode()).hexdigest()
result['current_images']={}
for name in ['partsignal-backend:'+rid,'partsignal-frontend:'+rid]:
 i=json.loads(call(['docker','image','inspect',name]))[0];result['current_images'][name]={'id':i['Id'],'repo_digests':i.get('RepoDigests') or [],'platform':i['Os']+'/'+i['Architecture']}
print(json.dumps(result,sort_keys=True))
