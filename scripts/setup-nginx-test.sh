#!/bin/sh
# 安装测试 API 的 Nginx 配置（前端走 Cloudflare Workers，不在此脚本内）
#
# 用法:
#   cd Velora-api
#   sudo ./scripts/setup-nginx-test.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_CONF="$ROOT/scripts/nginx/velora-api-test.aipassly.com.conf"

if [ ! -f "$API_CONF" ]; then
  echo "找不到 API Nginx 配置: $API_CONF"
  exit 1
fi

cp "$API_CONF" /etc/nginx/sites-available/velora-api-test.aipassly.com.conf
ln -sf /etc/nginx/sites-available/velora-api-test.aipassly.com.conf /etc/nginx/sites-enabled/

echo "Nginx API 配置已复制。若尚未申请证书，请执行:"
echo "  sudo certbot --nginx -d velora-api-test.aipassly.com"
echo ""
nginx -t
systemctl reload nginx
echo "Nginx 已 reload。"
echo ""
echo "前端 velora-test.aipassly.com → Cloudflare Workers (yarn deploy:test)"
