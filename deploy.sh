#!/usr/bin/env bash
# 本机构建前端静态资源，上传到远程服务器，重建前端镜像并等待健康检查通过。
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$ROOT/.deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/.deploy.env"
fi

DEPLOY_HOST="${DEPLOY_HOST:-172.171.113.14}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_USER="${DEPLOY_USER:-fnii}"
DEPLOY_REMOTE_ROOT="${DEPLOY_REMOTE_ROOT:-/opt/aigc-dit}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-aigc-dit-frontend:local}"
DEPLOY_PASSWORDLESS="${DEPLOY_PASSWORDLESS:-0}"
SKIP_BUILD=0

usage() {
  cat <<'EOF'
用法：./deploy.sh [--skip-build]

  --skip-build  跳过 npm build，发布 dist 中已有的静态资源

连接参数可写入项目根目录的 .deploy.env，参考 .deploy.env.example。
EOF
}

case "${1:-}" in
  "") ;;
  --skip-build) SKIP_BUILD=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

for command_name in ssh scp tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "缺少命令：$command_name" >&2
    exit 1
  }
done

SSH_OPTIONS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -p "$DEPLOY_PORT")
SCP_OPTIONS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -P "$DEPLOY_PORT")

if [[ "$DEPLOY_USER" == "root" ]]; then
  if [[ "$DEPLOY_PASSWORDLESS" == "1" ]]; then
    SSH=(ssh "${SSH_OPTIONS[@]}")
    SCP=(scp "${SCP_OPTIONS[@]}")
  else
    command -v sshpass >/dev/null 2>&1 || {
      echo "缺少 sshpass；macOS 可执行：brew install hudochenkov/sshpass/sshpass" >&2
      echo "或配置 SSH key，并设置 DEPLOY_PASSWORDLESS=1。" >&2
      exit 1
    }
    if [[ -z "${DEPLOY_PASSWORD:-}" ]]; then
      read -rsp "${DEPLOY_USER}@${DEPLOY_HOST} 的 SSH 密码：" DEPLOY_PASSWORD
      echo
    fi
    export SSHPASS="$DEPLOY_PASSWORD"
    SSH=(sshpass -e ssh "${SSH_OPTIONS[@]}")
    SCP=(sshpass -e scp "${SCP_OPTIONS[@]}")
  fi
  SUDO_COMMAND=(bash -s --)
elif [[ "$DEPLOY_PASSWORDLESS" == "1" ]]; then
  SSH=(ssh "${SSH_OPTIONS[@]}")
  SCP=(scp "${SCP_OPTIONS[@]}")
  SUDO_COMMAND=(sudo -n bash -s --)
else
  command -v sshpass >/dev/null 2>&1 || {
    echo "缺少 sshpass；macOS 可执行：brew install hudochenkov/sshpass/sshpass" >&2
    echo "或配置 SSH key + 免密 sudo，并设置 DEPLOY_PASSWORDLESS=1。" >&2
    exit 1
  }
  if [[ -z "${DEPLOY_PASSWORD:-}" ]]; then
    read -rsp "${DEPLOY_USER}@${DEPLOY_HOST} 的 SSH/sudo 密码：" DEPLOY_PASSWORD
    echo
  fi
  export SSHPASS="$DEPLOY_PASSWORD"
  SSH=(sshpass -e ssh "${SSH_OPTIONS[@]}")
  SCP=(sshpass -e scp "${SCP_OPTIONS[@]}")
  SUDO_COMMAND=(sudo -S -p '' bash -s --)
fi

run_remote_root() {
  local remote_script remote_command
  remote_script="$(cat)"
  printf -v remote_command '%q ' "${SUDO_COMMAND[@]}" "$@"
  if [[ "$DEPLOY_PASSWORDLESS" == "1" || "$DEPLOY_USER" == "root" ]]; then
    printf '%s\n' "$remote_script" | "${SSH[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$remote_command"
  else
    {
      printf '%s\n' "$DEPLOY_PASSWORD"
      printf '%s\n' "$remote_script"
    } | "${SSH[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$remote_command"
  fi
}

if [[ "$SKIP_BUILD" != "1" ]]; then
  command -v npm >/dev/null 2>&1 || {
    echo "缺少 npm。" >&2
    exit 1
  }
  echo "[1/4] 构建前端静态资源..."
  (cd "$ROOT" && npm run build)
else
  echo "[1/4] 已跳过前端构建。"
fi

[[ -f "$ROOT/dist/index.html" ]] || {
  echo "找不到 dist/index.html，请先执行 npm run build。" >&2
  exit 1
}

LOCAL_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/aigc-dit-frontend.XXXXXX")"
ARCHIVE="$LOCAL_STAGE/frontend.tgz"
REMOTE_ARCHIVE="/tmp/aigc-dit-frontend-${USER:-local}-$$.tgz"
cleanup() { rm -rf -- "$LOCAL_STAGE"; }
trap cleanup EXIT

tar -czf "$ARCHIVE" \
  -C "$ROOT" dist nginx.conf \
  -C "$ROOT/deploy" Dockerfile.prebuilt 40-app-name.sh

echo "[2/4] 上传发布包到 $DEPLOY_USER@$DEPLOY_HOST..."
"${SCP[@]}" "$ARCHIVE" "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_ARCHIVE"

echo "[3/4] 更新远程前端容器..."
run_remote_root "$DEPLOY_REMOTE_ROOT" "$REMOTE_ARCHIVE" "$FRONTEND_IMAGE" <<'REMOTE_SCRIPT'
set -Eeuo pipefail
remote_root="$1"
archive="$2"
image="$3"
backend_root="$remote_root/aigc-dit-be"
stage="$(mktemp -d /tmp/aigc-dit-frontend.XXXXXX)"
cleanup() { rm -rf -- "$stage" "$archive"; }
trap cleanup EXIT

[[ -f "$backend_root/docker-compose.yml" ]] || {
  echo "远程缺少 $backend_root/docker-compose.yml" >&2
  exit 1
}

tar -xzf "$archive" -C "$stage"
docker build -f "$stage/Dockerfile.prebuilt" -t "$image" "$stage"
docker compose -f "$backend_root/docker-compose.yml" up -d --no-deps --no-build --force-recreate frontend

for ((i=1; i<=24; i++)); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' dit-frontend 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "前端健康检查通过。"
    exit 0
  fi
  if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
    docker compose -f "$backend_root/docker-compose.yml" logs --tail=100 frontend
    echo "前端启动失败：$status" >&2
    exit 1
  fi
  echo "等待前端启动（$i/24，当前：${status:-unknown}）..."
  sleep 5
done

docker compose -f "$backend_root/docker-compose.yml" logs --tail=100 frontend
echo "前端健康检查超时。" >&2
exit 1
REMOTE_SCRIPT

echo "[4/4] 前端发布完成：http://$DEPLOY_HOST:8088/"
