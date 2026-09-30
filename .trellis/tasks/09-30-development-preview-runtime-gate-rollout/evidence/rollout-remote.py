"""本任务受控远端操作；只输出 allowlist 身份与固定状态。"""
import fcntl, hashlib, json, os, re, stat, subprocess, sys, tempfile
from pathlib import Path
RID='preview-20260930-111500-2f171300'
OLD='preview-20260929-082104-4e85aaf9'
ROOT=Path('/root/partsignal')
REL=ROOT/'releases'/RID
ENV=ROOT/'shared/.env.staging'
BACK=ROOT/'shared/runtime-gate-rollout-backups'/RID
ARCH=ROOT/'releases'/(RID+'.tar.gz')
OLD_SHA='05adbfab384d9417d60e7e28d516a17ea4f84c5a9e778ebcb8e02c5db104ee85'
NEW_SHA='3f43478292b82002c4bc6bae44adb580f939f6c74219346d0cb5364fc41141cf'
ARCH_SHA='c83c6ece8f11e1c4fa4d340dc50fd7dde6b828948598febd255f75577ef8e0d2'
BACKEND='partsignal-backend:'+RID
FRONTEND='partsignal-frontend:'+RID

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def emit(**kw):print(json.dumps(kw,sort_keys=True),flush=True)
def checked_env(expected):
 s=ENV.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600
 raw=ENV.read_bytes();assert hashlib.sha256(raw).hexdigest()==expected
 return raw

def run(args, *, cwd=None, env=None, input=None):
 p=subprocess.run(args,cwd=cwd,env=env if env is not None else process_env(),input=input,capture_output=True)
 # 不将第三方 stdout/stderr 原文落盘；只记录命令阶段及退出码。
 emit(operation=args[0]+' '+args[1],exit_code=p.returncode)
 assert p.returncode==0,'COMMAND_FAILED'
 return p.stdout

def compose(rid=RID,root=REL):
 return ['docker','compose','--project-name','partsignal-staging','--env-file',str(ENV),'-f',str(root/'deploy/compose.staging.yaml')]
def process_env(rid=RID):return {'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','PARTSIGNAL_VERSION':rid,'PARTSIGNAL_DATA_ROOT':'/root/partsignal-data','PARTSIGNAL_BACKEND_IMAGE':'partsignal-backend','PARTSIGNAL_FRONTEND_IMAGE':'partsignal-frontend'}
def sql(q):
 return run(['docker','exec','partsignal-staging-postgres-1','psql','-U','partsignal','-d','partsignal','-At','-c',q]).decode().strip()
def jobs_zero():assert sql("SELECT count(*) FROM generation_jobs WHERE status IN ('PENDING','RUNNING')")=='0','ACTIVE_JOBS_BLOCKER'
def sync_dir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def images():
 d={}
 for name in [BACKEND,FRONTEND,'partsignal-backend:'+OLD,'partsignal-frontend:'+OLD]:
  x=json.loads(run(['docker','image','inspect',name]))[0]
  d[name]={'id':x['Id'],'repo_digests':x.get('RepoDigests') or [],'platform':x['Os']+'/'+x['Architecture']}
  assert d[name]['repo_digests'] and d[name]['platform']=='linux/amd64'
 return d

stage=sys.argv[1]
assert os.getuid()==0
# 整个单阶段内排他锁；阶段之间重新做 checksum/current/job 门禁。
lock=os.open(ROOT/'shared/.runtime-gate-rollout.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
try:
 if stage=='backup':
  assert os.readlink(ROOT/'current')=='releases/'+OLD
  raw=checked_env(OLD_SHA);jobs_zero()
  BACK.parent.mkdir(mode=0o700,exist_ok=True);BACK.mkdir(mode=0o700)
  with (BACK/'env.staging.original').open('xb') as f:
   os.fchmod(f.fileno(),0o600);f.write(raw);f.flush();os.fsync(f.fileno())
  dump=BACK/'postgres.dump'
  with dump.open('xb') as f:
   os.fchmod(f.fileno(),0o600)
   p=subprocess.run(['docker','exec','partsignal-staging-postgres-1','pg_dump','-U','partsignal','-d','partsignal','-Fc','--no-owner'],stdout=f,stderr=subprocess.PIPE,env=process_env())
   assert p.returncode==0,'DATABASE_BACKUP_FAILED';f.flush();os.fsync(f.fileno())
  assert dump.stat().st_size>0
  # 验证 custom archive 可完整解析；不输出目录条目或表正文。
  run(['docker','exec','-i','partsignal-staging-postgres-1','pg_restore','--list'],input=dump.read_bytes())
  sync_dir(BACK)
  emit(status='BACKUP_COMPLETE',env_backup_path=str(BACK/'env.staging.original'),env_backup_bytes=len(raw),env_backup_sha256=sha(BACK/'env.staging.original'),database_backup_path=str(dump),database_backup_bytes=dump.stat().st_size,database_backup_sha256=sha(dump),mode='0600',schema=sql('SELECT version_num FROM alembic_version'))
 elif stage=='prepare':
  checked_env(OLD_SHA);jobs_zero();assert sha(ARCH)==ARCH_SHA and ARCH.stat().st_size==1941504
  REL.mkdir(mode=0o755)
  run(['tar','-xzf',str(ARCH),'-C',str(REL)])
  assert not list(REL.rglob('._*'))
  for critical in ['backend/alembic/versions','deploy/compose.staging.yaml','deploy/scripts/deploy-staging.sh','deploy/nginx/partsignal-security-headers.conf']:
   run(['diff','-qr',str(ROOT/'releases'/OLD/critical),str(REL/critical)])
  (REL/'.env.staging').symlink_to(ENV)
  for tag in [BACKEND,FRONTEND]:
   assert subprocess.run(['docker','image','inspect',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=process_env()).returncode!=0,'TAG_EXISTS'
  run(compose()+['config','--quiet'],env=process_env())
  run(compose()+['build','api','frontend'],env=process_env())
  emit(status='RELEASE_PREPARED',images=images(),archive_sha256=sha(ARCH))
 elif stage=='candidate':
  raw=checked_env(OLD_SHA);jobs_zero();assert sha(BACK/'env.staging.original')==OLD_SHA
  template=(REL/'.env.staging.example').read_text()
  known={x.split('=',1)[0] for x in template.splitlines() if x and not x.startswith('#')}
  assert not any(c<32 and c!=10 or c==127 for c in raw),'ENV_CONTROL_CHARACTER'
  values={}
  for line in raw.decode('utf-8').splitlines():
   if not line or line.startswith('#'):continue
   assert '=' in line
   key,value=line.split('=',1)
   assert re.fullmatch('[A-Z][A-Z0-9_]*',key) and key in known and key not in values,'INVALID_ENV_KEY'
   assert not any(ord(c)<32 or ord(c)==127 or c in '$`' for c in value),'UNSAFE_ENV_LITERAL'
   values[key]=value
  assert set(values)==known and len(values)==38
  assert raw.count(b'CONTENT_GENERATOR=deterministic\n')==1
  candidate=raw.replace(b'CONTENT_GENERATOR=deterministic\n',b'CONTENT_GENERATOR=openai-compatible\n')
  assert hashlib.sha256(candidate).hexdigest()==NEW_SHA
  dest=ENV.parent/('.runtime-gate-candidate-'+RID)
  with dest.open('xb') as f:
   os.fchmod(f.fileno(),0o600);f.write(candidate);f.flush();os.fsync(f.fileno())
  sync_dir(dest.parent)
  run(['docker','run','--rm','--pull','never','--network','none','--read-only','--env-file',str(dest),BACKEND,'python','-c',"from app.config import settings; assert settings.environment=='staging' and settings.content_generator=='openai-compatible' and settings.object_storage_backend=='development' and not settings.ai_allow_local_http and not settings.generation_eager"])
  # 原始维护源不改；release 的配置链接在候选预检期间引用共享目录内的受控暂存。
  temp=REL/'.env.staging.candidate-link';temp.symlink_to(dest);os.replace(temp,REL/'.env.staging')
  try:
   run(compose()+['config','--quiet'],env=process_env())
   config=json.loads(run(compose()+['config','--format','json'],env=process_env()))
   assert config['name']=='partsignal-staging','COMPOSE_PROJECT_DRIFT'
   for service in ['api','worker','scheduler','fake-oss','migrate','postgres']:
    runtime=config['services'][service]['environment'];assert all(runtime[k]==v for k,v in {**values,'CONTENT_GENERATOR':'openai-compatible'}.items()),'COMPOSE_ENV_DRIFT'
   assert config['services']['postgres']['volumes'][0]['source']=='/root/partsignal-data/postgres'
   assert config['services']['redis']['volumes'][0]['source']=='/root/partsignal-data/redis'
   assert config['services']['fake-oss']['volumes'][0]['source']=='/root/partsignal-data/objects'
  finally:
   temp.symlink_to(ENV);os.replace(temp,REL/'.env.staging')
  run(compose()+['run','--rm','--pull','never','--no-deps','api','python','-m','app.cli','preflight-integrity'],env=process_env())
  assert sql('SELECT version_num FROM alembic_version')=='0043_geo_platform_identity'
  frozen=images()
  with (BACK/'candidate-images.json').open('x') as f:
   os.fchmod(f.fileno(),0o600);json.dump(frozen,f,sort_keys=True);f.flush();os.fsync(f.fileno())
  sync_dir(BACK)
  emit(status='CANDIDATE_VALID',candidate_bytes=len(candidate),candidate_sha256=sha(dest),only_changed_key='CONTENT_GENERATOR',mode='openai-compatible',images=frozen)
 elif stage=='switch':
  checked_env(OLD_SHA);jobs_zero();assert os.readlink(ROOT/'current')=='releases/'+OLD
  dest=ENV.parent/('.runtime-gate-candidate-'+RID);assert sha(dest)==NEW_SHA
  assert images()==json.loads((BACK/'candidate-images.json').read_text()),'FROZEN_IMAGE_DRIFT'
  # 停 API 以关闭 Job 新入口；Scheduler 停止补投递。排空证据不合格时只恢复原进程，不安装 env。
  run(compose(OLD,ROOT/'releases'/OLD)+['stop','-t','90','api','scheduler'],env=process_env(OLD))
  try:jobs_zero()
  except BaseException:
   run(compose(OLD,ROOT/'releases'/OLD)+['up','-d','--wait','--no-deps','--pull','never','api','scheduler'],env=process_env(OLD));raise
  run(compose(OLD,ROOT/'releases'/OLD)+['stop','-t','90','worker'],env=process_env(OLD));jobs_zero()
  checked_env(OLD_SHA)
  s=dest.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600
  os.replace(dest,ENV);sync_dir(ENV.parent);checked_env(NEW_SHA)
  emit(status='ENV_INSTALLED_PROCESSES_STOPPED',mode='openai-compatible',bytes=ENV.stat().st_size,sha256=sha(ENV))
  # 按现有fast分支顺序手工升级，消费已验证镜像，禁止再次build或pull。
  assert images()==json.loads((BACK/'candidate-images.json').read_text()),'FROZEN_IMAGE_DRIFT'
  run(compose()+['config','--quiet'],env=process_env())
  run(compose()+['up','-d','--no-build','--pull','never','postgres','redis','fake-oss'],env=process_env())
  run(compose()+['run','--rm','--pull','never','--no-deps','api','python','-m','app.cli','preflight-integrity'],env=process_env())
  run(compose()+['up','-d','--wait','--no-build','--pull','never','worker','scheduler'],env=process_env())
  run(compose()+['up','-d','--wait','--no-build','--pull','never','api','frontend'],env=process_env())
  assert images()==json.loads((BACK/'candidate-images.json').read_text()),'FROZEN_IMAGE_DRIFT'
  emit(status='DEPLOY_COMPLETE',mode='openai-compatible',images=images())
 elif stage=='rollback':
  # 保留失败现场；恢复应用/env 不还原数据库，不删除失败 Job/Version 或新资源。
  assert os.readlink(ROOT/'current') in ['releases/'+OLD,'releases/'+RID]
  current_sha=sha(ENV);assert current_sha in [OLD_SHA,NEW_SHA],'CONCURRENT_ENV_DRIFT'
  jobs_zero()
  run(compose()+['stop','-t','90','api','scheduler'],env=process_env());jobs_zero()
  run(compose()+['stop','-t','90','worker'],env=process_env());jobs_zero()
  if current_sha==NEW_SHA:
   raw=(BACK/'env.staging.original').read_bytes();assert hashlib.sha256(raw).hexdigest()==OLD_SHA
   fd,path=tempfile.mkstemp(prefix='.runtime-gate-restore-',dir=ENV.parent)
   with os.fdopen(fd,'wb') as f:os.fchmod(f.fileno(),0o600);f.write(raw);f.flush();os.fsync(f.fileno())
   checked_env(NEW_SHA);os.replace(path,ENV);sync_dir(ENV.parent)
  checked_env(OLD_SHA)
  for name,expected in [('partsignal-backend:'+OLD,'sha256:434a136729a8f2eb33ba260a870cd3f3f9f37a6ffeba1e5999a967cfae893642'),('partsignal-frontend:'+OLD,'sha256:e98d2c8c65074f6051235eae59cf770d5239ea4fcd3987796c94945d9b3710cb')]:
   assert json.loads(run(['docker','image','inspect',name]))[0]['Id']==expected
  run(compose(OLD,ROOT/'releases'/OLD)+['up','-d','--wait','--no-build','--pull','never','postgres','redis','fake-oss','worker','scheduler','api','frontend'],env=process_env(OLD))
  emit(status='OLD_RUNTIME_RESTORED_VERIFY_BEFORE_CURRENT',sha256=sha(ENV))
 elif stage=='rollback-current':
  checked_env(OLD_SHA);jobs_zero();assert os.readlink(ROOT/'current')=='releases/'+RID
  # 主代理必须先完成旧容器/公网复验后才调用该独立阶段。
  nextlink=ROOT/('.current-restore-'+RID);nextlink.symlink_to('releases/'+OLD);os.replace(nextlink,ROOT/'current');sync_dir(ROOT)
  emit(status='CURRENT_RESTORED',target=os.readlink(ROOT/'current'))
 elif stage=='current':
  checked_env(NEW_SHA);jobs_zero();assert os.readlink(ROOT/'current')=='releases/'+OLD
  nextlink=ROOT/('.current-'+RID);nextlink.symlink_to('releases/'+RID);os.replace(nextlink,ROOT/'current');sync_dir(ROOT)
  emit(status='CURRENT_SWITCHED',target=os.readlink(ROOT/'current'))
 else:raise ValueError('UNKNOWN_STAGE')
except BaseException as error:
 emit(status='FAILED_PRESERVED',stage=stage,error_type=type(error).__name__)
 raise SystemExit(2)
finally:os.close(lock)
