<<<<<<< Updated upstream
# 由 aigc-dit-be/docker-compose.yml 以 context ../aigc-dit-fe 构建
# 有 package.json 时走 Vite 构建；否则写入占位页，保证 M0 能 compose up
FROM node:22-alpine AS build
WORKDIR /app

COPY . .

RUN if [ -f package.json ]; then \
      if [ -f package-lock.json ]; then npm ci; \
      elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
      elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
      else npm install; fi \
      && npm run build; \
    else \
      mkdir -p dist \
      && printf '%s\n' \
        '<!DOCTYPE html>' \
        '<html lang="zh-CN">' \
        '<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' \
        '<title>同道</title></head>' \
        '<body style="margin:0;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0b0f19;color:#e8eefc">' \
        '<div style="text-align:center"><h1>同道</h1>' \
        '<p>前端静态资源尚未接入，请完成原型迁移后重新构建此镜像。</p>' \
        '<p><a href="/api/health" style="color:#8ab4ff">/api/health</a></p></div></body></html>' \
        > dist/index.html; \
    fi

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
=======
# 由 aigc-dit-be/docker-compose.yml 以 context ../aigc-dit-fe 构建
# 有 package.json 时走 Vite 构建；否则写入占位页，保证 M0 能 compose up
FROM node:22-alpine AS build
WORKDIR /app

COPY . .

RUN if [ -f package.json ]; then \
      if [ -f package-lock.json ]; then npm ci; \
      elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
      elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \
      else npm install; fi \
      && npm run build; \
    else \
      mkdir -p dist \
      && printf '%s\n' \
        '<!DOCTYPE html>' \
        '<html lang="zh-CN">' \
        '<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>' \
        '<title>致启·光驭</title></head>' \
        '<body style="margin:0;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0b0f19;color:#e8eefc">' \
        '<div style="text-align:center"><h1>致启·光驭</h1>' \
        '<p>前端静态资源尚未接入，请完成原型迁移后重新构建此镜像。</p>' \
        '<p><a href="/api/health" style="color:#8ab4ff">/api/health</a></p></div></body></html>' \
        > dist/index.html; \
    fi

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
>>>>>>> Stashed changes
