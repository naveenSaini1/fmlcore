#!/usr/bin/env bash
# FMLCore server deployer. Keep the operator deploy.conf outside Git.
set +x
set -Eeuo pipefail
umask 077
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CONFIG_FILE=${FML_DEPLOY_CONFIG:-"$SCRIPT_DIR/deploy.conf"}
SOURCE_ARCHIVE=""
usage() {
  cat <<'HELP'
Usage: sudo bash deploy.sh [--source-archive /path/working-tree.tar.gz]
       bash deploy.sh --help

Copy deploy.sh and private deploy.conf together to an Ubuntu/Debian server.
Set DOMAIN in deploy.conf (or enter it when prompted). Point its DNS at the
server; ports 80/443 must be available. SMTP is needed for signup email codes.
Git credentials are used through temporary askpass, never in the remote URL.
An optional source archive overlays the pulled revision for uncommitted changes.
First deployment uses an empty database. Reruns preserve data and take backups.
No containers or volumes are deleted. No automatic rollback of schema changes.
HELP
}
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0;;
    --source-archive) [[ $# -ge 2 ]] || { usage; exit 2; }; SOURCE_ARCHIVE=$2; shift 2;;
    *) usage; exit 2;;
  esac
done
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash deploy.sh (see --help).'; exit 1; }
[[ -f $CONFIG_FILE ]] || { echo "Missing private config: $CONFIG_FILE"; exit 1; }
[[ $(stat -c '%a' "$CONFIG_FILE") == 600 ]] || { echo 'Set deploy.conf permissions to 600 first.'; exit 1; }
# This is an operator-owned shell config; it is never copied into build contexts.
set -a
source "$CONFIG_FILE"
set +a
: "${REPO_URL:?Missing REPO_URL}" "${BRANCH:=main}" "${INSTALL_DIR:=/opt/fmlcore}"
: "${GITHUB_TOKEN:?Missing GITHUB_TOKEN}" "${GITHUB_USER:=x-access-token}" "${DOMAIN:=}"
: "${ADMIN_DOMAIN:=}" "${ADMIN_EMAILS:=}"
if [[ -z $DOMAIN ]]; then read -r -p 'Public domain (example: fmlcore.example.com): ' DOMAIN; fi
[[ $DOMAIN =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && $DOMAIN == *.* && $DOMAIN != *..* ]] || { echo 'Set DOMAIN to a DNS hostname without a scheme or path.'; exit 1; }
[[ ! $DOMAIN =~ ^[0-9.]+$ ]] || { echo 'Use a domain pointing at this server for public HTTPS.'; exit 1; }
if [[ -n $ADMIN_DOMAIN ]]; then
 [[ $ADMIN_DOMAIN =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ && $ADMIN_DOMAIN != *..* && $ADMIN_DOMAIN != "$DOMAIN" ]] || { echo 'Invalid ADMIN_DOMAIN.'; exit 1; }
fi
[[ $INSTALL_DIR == /* && $INSTALL_DIR != / && $INSTALL_DIR != *$'\n'* && $INSTALL_DIR != *:* ]] || { echo 'INSTALL_DIR must be an absolute dedicated directory.'; exit 1; }
[[ $REPO_URL == https://github.com/* && $REPO_URL != *@* && $REPO_URL != *$'\n'* ]] || { echo 'Use a credential-free https://github.com/owner/repo.git URL.'; exit 1; }
if [[ -n $SOURCE_ARCHIVE ]]; then SOURCE_ARCHIVE=$(realpath -- "$SOURCE_ARCHIVE"); [[ -f $SOURCE_ARCHIVE ]]; fi
mkdir -p "$INSTALL_DIR"
exec 9>"$INSTALL_DIR/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.'; exit 1; }
trap 'echo "Deployment failed at line $LINENO. Existing database volumes are preserved. Check the service logs; backups are under $INSTALL_DIR/backups." >&2' ERR
export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null || ! command -v curl >/dev/null || ! command -v python3 >/dev/null; then
 apt-get update
 apt-get install -y ca-certificates curl git openssl python3 tar
fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
 echo 'Installing Docker Engine and Compose from Docker’s official apt repository...'
 source /etc/os-release
 [[ $ID == ubuntu || $ID == debian ]] || { echo 'Automatic Docker installation supports Ubuntu/Debian.'; exit 1; }
 apt-get update
 apt-get install -y ca-certificates curl gnupg
 install -m 0755 -d /etc/apt/keyrings
 curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker-fmlcore.asc
 chmod a+r /etc/apt/keyrings/docker-fmlcore.asc
 printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker-fmlcore.asc] https://download.docker.com/linux/%s %s stable\n' "$(dpkg --print-architecture)" "$ID" "${UBUNTU_CODENAME:-$VERSION_CODENAME}" > /etc/apt/sources.list.d/docker-fmlcore.list
 apt-get update
 if command -v docker >/dev/null; then
  apt-get install -y docker-compose-plugin
 else
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
 fi
fi
systemctl enable --now docker
mkdir -p "$INSTALL_DIR/releases" "$INSTALL_DIR/backups"
ASKPASS=$(mktemp "$INSTALL_DIR/.askpass.XXXXXX")
cleanup() { [[ -z ${ASKPASS:-} ]] || unlink "$ASKPASS"; }
trap cleanup EXIT
cat > "$ASKPASS" <<'ASK'
#!/bin/sh
case "$1" in *Username*) printf '%s\n' "$GITHUB_USER";; *) printf '%s\n' "$GITHUB_TOKEN";; esac
ASK
chmod 700 "$ASKPASS"
export GITHUB_USER GITHUB_TOKEN GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0
# No credential helper is allowed to persist the token.
git_auth() { git -c credential.helper= "$@"; }
if [[ ! -d $INSTALL_DIR/repository/.git ]]; then
 [[ ! -e $INSTALL_DIR/repository ]] || { echo 'repository path exists without .git'; exit 1; }
 git_auth clone --single-branch --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR/repository"
else
 [[ -z $(git -C "$INSTALL_DIR/repository" status --porcelain) ]] || { echo 'Deployment repository has local edits; preserve or resolve them before retrying.'; exit 1; }
 git -C "$INSTALL_DIR/repository" remote set-url origin "$REPO_URL"
 git_auth -C "$INSTALL_DIR/repository" fetch origin "$BRANCH"
 if git -C "$INSTALL_DIR/repository" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git -C "$INSTALL_DIR/repository" checkout "$BRANCH"
  git -C "$INSTALL_DIR/repository" merge --ff-only FETCH_HEAD
 else
  git -C "$INSTALL_DIR/repository" checkout -b "$BRANCH" FETCH_HEAD
 fi
fi
cleanup; ASKPASS=""; unset GITHUB_TOKEN GIT_ASKPASS
COMMIT=$(git -C "$INSTALL_DIR/repository" rev-parse HEAD)
RELEASE="$INSTALL_DIR/releases/$(date -u +%Y%m%dT%H%M%SZ)-${COMMIT:0:12}-$$"
mkdir "$RELEASE"
git -C "$INSTALL_DIR/repository" archive HEAD | tar -x -C "$RELEASE"
if [[ -n $SOURCE_ARCHIVE ]]; then
 python3 - "$SOURCE_ARCHIVE" "$RELEASE" <<'PY'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for item in archive.getmembers():
        p = PurePosixPath(item.name)
        if p.is_absolute() or '..' in p.parts or item.issym() or item.islnk() or not (item.isdir() or item.isfile()):
            raise SystemExit('Unsafe source archive member')
        if any(part in {'.git', '.local-deploy', 'uploads', 'node_modules', '.venv', '__pycache__'} or part.startswith('.next') or part.startswith('.env') and not part.endswith('.example') for part in p.parts):
            raise SystemExit('Source archive contains excluded/private data')
    archive.extractall(sys.argv[2])
PY
fi
export INSTALL_DIR RELEASE DOMAIN ADMIN_DOMAIN ADMIN_EMAILS
python3 - <<'PY'
import base64, json, os, secrets, subprocess
from pathlib import Path
root = Path(os.environ['INSTALL_DIR'])
state = root / 'production-secrets.json'
if state.exists():
    generated = json.loads(state.read_text())
else:
    generated = {k: secrets.token_hex(32) for k in ['POSTGRES_PASSWORD','JWT_SECRET','SAME_SKY_HASH_SECRET','EMAIL_OTP_SECRET']}
    with state.open('x') as f: json.dump(generated, f)
    state.chmod(0o600)
for key in ['POSTGRES_PASSWORD','JWT_SECRET','SAME_SKY_HASH_SECRET','EMAIL_OTP_SECRET']:
    if not generated.get(key): raise SystemExit('Production secret state is incomplete; preserve and repair it before retrying.')
# Generate the Web Push key pair once and keep it with the other release secrets.
push_keys = ('WEB_PUSH_PRIVATE_KEY', 'WEB_PUSH_PUBLIC_KEY')
if not any(generated.get(key) for key in push_keys):
    private = subprocess.check_output(['openssl', 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-outform', 'DER'])
    public = subprocess.check_output(['openssl', 'ec', '-inform', 'DER', '-pubout', '-outform', 'DER'], input=private, stderr=subprocess.DEVNULL)[-65:]
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
    generated.update(WEB_PUSH_PRIVATE_KEY=encode(private), WEB_PUSH_PUBLIC_KEY=encode(public))
    temporary = state.with_suffix('.tmp')
    temporary.write_text(json.dumps(generated) + '\n')
    temporary.chmod(0o600)
    temporary.replace(state)
if not all(generated.get(key) for key in push_keys):
    raise SystemExit('Web Push key state is incomplete; restore the original key pair.')
domain = os.environ['DOMAIN']
admin = os.environ.get('ADMIN_DOMAIN', '')
env = {'SAME_SKY_WORKER_MANAGED':'true', 'APP_ENV':'production', 'COOKIE_SECURE':'true', 'JWT_TTL_DAYS':'14',
       'CORS_ORIGINS': 'https://' + domain + (',https://' + admin if admin else ''),
       'ADMIN_EMAILS':os.environ.get('ADMIN_EMAILS',''),
       'WEB_PUSH_SUBJECT': os.environ.get('WEB_PUSH_SUBJECT') or 'mailto:admin@' + domain,
       **{k:v for k,v in generated.items() if k != 'POSTGRES_PASSWORD'},
       'DATABASE_URL':f"postgresql+psycopg://fmlcore:{generated['POSTGRES_PASSWORD']}@db:5432/fmlcore"}
if domain == 'fmlcore.com':
    env['CORS_ORIGINS'] += ',https://www.fmlcore.com,https://fmlcore.34-131-221-150.sslip.io,http://localhost:18080'
keys = ['GOOGLE_CLIENT_ID','SMTP_HOST','SMTP_PORT','SMTP_USERNAME','SMTP_PASSWORD','SMTP_FROM_EMAIL','SMTP_FROM_NAME','SMTP_SECURITY',
        'GEMINI_API_KEY','GEMINI_MODEL','GEMINI_EMBEDDING_MODEL','GEMINI_PAID_SERVICE_CONFIRMED','GROQ_API_KEY','GROQ_MODEL',
        'SAME_SKY_REQUIRED_POSTS','SAME_SKY_REQUIRED_CONFESSIONS','SAME_SKY_RETRY_MINUTES']
env.update({k:os.environ[k] for k in keys if os.environ.get(k)})
# Compose interpolation must not treat a dollar sign in a password as a variable.
escape = lambda values: {k:str(v).replace('$','$$') for k,v in values.items()}
release = Path(os.environ['RELEASE'])
services = {
 'db': {'image':'pgvector/pgvector:pg16','restart':'unless-stopped',
        'environment':escape({'POSTGRES_USER':'fmlcore','POSTGRES_DB':'fmlcore','POSTGRES_PASSWORD':generated['POSTGRES_PASSWORD']}),
        'volumes':['postgres_data:/var/lib/postgresql/data'],
        'healthcheck':{'test':['CMD-SHELL','pg_isready -U fmlcore -d fmlcore'],'interval':'5s','timeout':'5s','retries':30}},
 'api': {'build':{'context':str(release/'backend')},'restart':'unless-stopped', 'environment':escape(env),
         'volumes':['uploads_data:/app/uploads'],'depends_on':{'db':{'condition':'service_healthy'}},
         'healthcheck':{'test':['CMD','python','-c',"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3)"], 'interval':'5s','timeout':'5s','retries':30,'start_period':'60s'}},
 'same-sky-worker': {'build':{'context':str(release/'backend')},'restart':'unless-stopped','environment':escape(env),
                     'command':['python','-m','app.same_sky_worker'],'depends_on':{'api':{'condition':'service_healthy'}}},
 'web': {'build':{'context':str(release/'front-end'),'args':{'API_ORIGIN':'http://api:8000'}},'restart':'unless-stopped',
         'environment':{'API_ORIGIN':'http://api:8000'},'depends_on':{'api':{'condition':'service_healthy'}}},
 'admin-web': {'build':{'context':str(release/'backend-front-end'),'args':{'API_ORIGIN':'http://api:8000'}},'restart':'unless-stopped',
         'environment':{'API_ORIGIN':'http://api:8000'},'ports':['127.0.0.1:3001:3001'],'depends_on':{'api':{'condition':'service_healthy'}}},
 'proxy': {'image':'caddy:2','restart':'unless-stopped','ports':['80:80','443:443','443:443/udp','127.0.0.1:8080:8080'],
           'volumes':[f'{release}/Caddyfile:/etc/caddy/Caddyfile:ro','caddy_data:/data','caddy_config:/config'],
           'depends_on':['web','admin-web']}}
config = {'services':services,'volumes':{name:{} for name in ['postgres_data','uploads_data','caddy_data','caddy_config']}}
if os.environ.get('STAGING_ONLY') == 'true':
    services['proxy']['ports'] = ['127.0.0.1:8080:80']
(root/'compose.json').write_text(json.dumps(config,indent=2)+'\n')
(root/'compose.json').chmod(0o600)
(release/'Caddyfile').write_text(domain + ''' {
    handle /ws {
        reverse_proxy api:8000
    }
    handle_path /api/* {
        reverse_proxy api:8000
    }
    handle {
        reverse_proxy web:3000
    }
}
''' + (admin + ''' {
    handle /ws {
        reverse_proxy api:8000
    }
    handle_path /api/* {
        reverse_proxy api:8000
    }
    handle {
        reverse_proxy admin-web:3001
    }
}
''' if admin else ''))
if os.environ.get('STAGING_ONLY') == 'true':
    caddy = release/'Caddyfile'
    caddy.write_text(caddy.read_text().replace(domain + ' {', ':80 {', 1))
# Preserve the custom-domain redirects on subsequent deployments.
if domain == 'fmlcore.com' and os.environ.get('STAGING_ONLY') != 'true':
    caddy = release/'Caddyfile'
    extra = "\nwww.fmlcore.com {\n    redir https://fmlcore.com{uri} permanent\n}\n\nhttp://34.131.221.150 {\n    redir https://fmlcore.com{uri} temporary\n}\n"
    primary, remainder = caddy.read_text().split('\n}', 1)
    aliases = ', fmlcore.34-131-221-150.sslip.io'
    first, routes = primary.split(' {\n', 1)
    preview = '\n:8080 {\n' + routes + '\n}\n'
    caddy.write_text(first + aliases + ' {\n' + routes + '\n}' + remainder + extra + preview)
if not env.get('SMTP_HOST') or not env.get('SMTP_FROM_EMAIL'):
    print('SMTP is not configured: email signup codes cannot be delivered until SMTP settings are added.')
if not env.get('GEMINI_API_KEY') or env.get('GEMINI_PAID_SERVICE_CONFIRMED','false').lower() != 'true':
    print('Same Sky AI stays disabled until its provider/billing settings are configured.')
PY
dc() { docker compose --project-name fmlcore --file "$INSTALL_DIR/compose.json" "$@"; }
# Validate privately; printing the expanded config would expose passwords.
dc config --quiet
# Build and validate before changing any running containers.
echo 'Building application images...'
dc build api web admin-web same-sky-worker
dc run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# Quiesce writers, then back up a consistent pre-migration state.
dc stop same-sky-worker api
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
if dc ps --status running --services | grep -qx db; then
 echo 'Backing up the existing database and uploaded files before updating...'
 dc exec -T db pg_dump -U fmlcore -d fmlcore | gzip > "$INSTALL_DIR/backups/$STAMP.sql.gz"
 dc run --rm --no-deps api tar -C /app/uploads -czf - . > "$INSTALL_DIR/backups/$STAMP-uploads.tar.gz"
fi
dc up -d --wait --wait-timeout 300 db api
dc up -d --wait --wait-timeout 300
printf 'Git revision: %s\nSource overlay: %s\nRelease directory: %s\n' "$COMMIT" "${SOURCE_ARCHIVE:-none}" "$RELEASE" > "$INSTALL_DIR/last-deployment.txt"
ln -sfn "$RELEASE" "$INSTALL_DIR/current"
if [[ ${STAGING_ONLY:-false} == true ]]; then
 curl --retry 10 --retry-delay 3 --retry-connrefused -fsS http://127.0.0.1:8080/api/health
 dc ps
 echo 'Staging deployment ready on server loopback port 8080. Domain ownership, DNS, and public HTTPS are pending.'
 exit 0
fi
echo 'Checking the public HTTPS health endpoint (DNS and ports 80/443 must be ready)...'
healthy=false
for attempt in $(seq 1 30); do
 if curl --connect-timeout 5 --max-time 10 -fsS "https://$DOMAIN/api/health" > /dev/null; then healthy=true; break; fi
 sleep 3
done
[[ $healthy == true ]] || { echo 'Containers started, but public HTTPS verification failed. Check DNS, firewall, and proxy logs.'; exit 1; }
dc ps
echo "Deployment ready: https://$DOMAIN"
echo "Management: docker compose -p fmlcore -f $INSTALL_DIR/compose.json ps"
echo 'Rerun this script for updates. Database and uploads are preserved.'
