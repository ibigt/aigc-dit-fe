#!/bin/sh
# 每次启动从镜像内的原件生成对外文件，避免上次写入的产品名在重启后残留。
# 优先级：非空 APP_NAME > /etc/dit/brand 第一行 > 同道
set -eu

HTML_ROOT=/usr/share/nginx/html
ORIG=/usr/share/nginx/html-orig
BRAND_FILE=/etc/dit/brand
DEFAULT_NAME=同道
NAME_FILE=/tmp/dit-app-name

trim() {
  printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

name=$(trim "${APP_NAME:-}")
if [ -z "$name" ] && [ -f "$BRAND_FILE" ]; then
  name=$(trim "$(sed -n '1p' "$BRAND_FILE" 2>/dev/null || true)")
fi
if [ -z "$name" ]; then
  name=$DEFAULT_NAME
fi

printf '%s' "$name" > "$NAME_FILE"
echo "dit app name: $name"

if [ -f "$ORIG/index.html" ]; then
  awk '
    function js_escape(s,    i, c, out, n) {
      out = ""
      n = length(s)
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (c == "\\") out = out "\\\\"
        else if (c == "\"") out = out "\\\""
        else if (c == "\n") out = out "\\n"
        else if (c == "\r") out = out ""
        else if (c == "<") out = out "\\u003c"
        else out = out c
      }
      return out
    }
    function inject(line, value,    key, p, from, q1, rest, q2) {
      key = "window.__DIT_APP_NAME__"
      p = index(line, key)
      if (p == 0) return line
      from = substr(line, p)
      q1 = index(from, "\"")
      if (q1 == 0) return line
      rest = substr(from, q1 + 1)
      q2 = index(rest, "\"")
      if (q2 == 0) return line
      return substr(line, 1, p + q1 - 1) value substr(rest, q2)
    }
    BEGIN {
      getline raw < "/tmp/dit-app-name"
      close("/tmp/dit-app-name")
      value = js_escape(raw)
      replaced = 0
    }
    {
      gsub(/\r/, "")
      if (index($0, "window.__DIT_APP_NAME__") > 0) {
        print inject($0, value)
        replaced = 1
        next
      }
      if (!replaced && index($0, "</head>") > 0) {
        print "<script>window.__DIT_APP_NAME__=\"" value "\";</script>"
        replaced = 1
      }
      print
    }
  ' "$ORIG/index.html" > "$HTML_ROOT/index.html"
fi

if [ -f "$ORIG/config.json" ]; then
  awk '
    function json_escape(s,    i, c, out, n) {
      out = ""
      n = length(s)
      for (i = 1; i <= n; i++) {
        c = substr(s, i, 1)
        if (c == "\\") out = out "\\\\"
        else if (c == "\"") out = out "\\\""
        else if (c == "\n") out = out "\\n"
        else if (c == "\r") out = out ""
        else out = out c
      }
      return out
    }
    function leading_ws(line,    i, c) {
      i = 1
      while (i <= length(line)) {
        c = substr(line, i, 1)
        if (c != " " && c != "\t") break
        i++
      }
      return substr(line, 1, i - 1)
    }
    function trailing_comma(line,    t, n) {
      t = line
      gsub(/\r/, "", t)
      sub(/[[:space:]]*$/, "", t)
      n = length(t)
      if (n > 0 && substr(t, n, 1) == ",") return ","
      return ""
    }
    function rewrite_key(line, key, value) {
      if (index(line, "\"" key "\"") == 0) return line
      return leading_ws(line) "\"" key "\": \"" value "\"" trailing_comma(line)
    }
    BEGIN {
      getline raw < "/tmp/dit-app-name"
      close("/tmp/dit-app-name")
      value = json_escape(raw)
    }
    {
      gsub(/\r/, "")
      if (index($0, "\"appName\"") > 0) {
        print rewrite_key($0, "appName", value)
        next
      }
      if (index($0, "\"shortName\"") > 0) {
        print rewrite_key($0, "shortName", value)
        next
      }
      print
    }
  ' "$ORIG/config.json" > "$HTML_ROOT/config.json"
fi

rm -f "$NAME_FILE"
