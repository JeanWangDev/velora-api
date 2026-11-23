#!/usr/bin/env python3
"""Regenerate OpenAPI auto-section with concrete request params from backend schemas."""
from __future__ import annotations

from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OA = ROOT / "docs" / "openapi.yaml"
MARKER = "# ---------------------------------------------------------------------------\n# 以下为对照代码路由自动补全的缺失接口"
MARKER2 = "# ---------------------------------------------------------------------------\n# 对照后端 validators/controllers 补全请求参数"

ACCT = ["funding", "trading", "futures", "earn", "margin"]
RESP = '      responses: { "200": { $ref: \'#/components/responses/Envelope\' } }'


def yaml_val(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if v is None:
        return "null"
    s = str(v)
    if s.replace(".", "", 1).isdigit() or s in ("true", "false", "null"):
        return s
    if any(c in s for c in ":#{}[],&*!|>%@`'\" \t"):
        return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return s


def schema_inline(meta: dict) -> str:
    parts = [f"type: {meta['type']}"]
    if "format" in meta:
        parts.append(f"format: {meta['format']}")
    if "enum" in meta:
        parts.append("enum: [" + ", ".join(yaml_val(e) for e in meta["enum"]) + "]")
    if "default" in meta:
        parts.append(f"default: {yaml_val(meta['default'])}")
    if "example" in meta:
        parts.append(f"example: {yaml_val(meta['example'])}")
    if meta.get("nullable"):
        parts.append("nullable: true")
    if "description" in meta:
        parts.append(f"description: {yaml_val(meta['description'])}")
    if meta["type"] == "array":
        items = meta.get("items", {"type": "string"})
        parts.append(f"items: {{ type: {items.get('type', 'string')} }}")
        if "minItems" in meta:
            parts.append(f"minItems: {meta['minItems']}")
    return "{ " + ", ".join(parts) + " }"


def qparam(name: str, typ: str = "string", required: bool = False, **meta) -> str:
    lines = [f"        - name: {name}", "          in: query"]
    if required:
        lines.append("          required: true")
    if "description" in meta:
        lines.append(f"          description: {meta['description']}")
    sch = {"type": typ, **{k: v for k, v in meta.items() if k != "description"}}
    lines.append(f"          schema: {schema_inline(sch)}")
    return "\n".join(lines)


def pparam(name: str, typ: str = "string") -> str:
    return f"        - {{ name: {name}, in: path, required: true, schema: {{ type: {typ} }} }}"


def body(props: dict, required: list[str] | None = None, required_body: bool = True) -> str:
    lines = [
        "      requestBody:",
        f"        required: {'true' if required_body else 'false'}",
        "        content:",
        "          application/json:",
        "            schema:",
        "              type: object",
    ]
    if required:
        lines.append(f"              required: [{', '.join(required)}]")
    lines.append("              properties:")
    for name, meta in props.items():
        # multi-line for arrays / long descriptions
        if meta.get("type") == "array" or "description" in meta:
            lines.append(f"                {name}:")
            lines.append(f"                  type: {meta['type']}")
            if meta.get("type") == "array":
                items = meta.get("items", {"type": "string"})
                lines.append(f"                  items: {{ type: {items.get('type', 'string')} }}")
                if "minItems" in meta:
                    lines.append(f"                  minItems: {meta['minItems']}")
            if "enum" in meta:
                lines.append(
                    "                  enum: ["
                    + ", ".join(yaml_val(e) for e in meta["enum"])
                    + "]"
                )
            if "example" in meta:
                lines.append(f"                  example: {yaml_val(meta['example'])}")
            if meta.get("nullable"):
                lines.append("                  nullable: true")
            if "default" in meta:
                lines.append(f"                  default: {yaml_val(meta['default'])}")
            if "description" in meta:
                lines.append(f"                  description: {meta['description']}")
            if "format" in meta:
                lines.append(f"                  format: {meta['format']}")
        else:
            lines.append(f"                {name}: {schema_inline(meta)}")
    return "\n".join(lines)


def op(
    method: str,
    tag: str,
    summary: str,
    *,
    security: str | None = None,
    params: str | None = None,
    body_yaml: str | None = None,
) -> str:
    lines = [f"    {method}:", f"      tags: [{tag}]", f"      summary: {summary}"]
    if security is not None:
        lines.append(f"      security: {security}")
    if params:
        lines.append("      parameters:")
        lines.append(params)
    if body_yaml:
        lines.append(body_yaml)
    lines.append(RESP)
    return "\n".join(lines)


def path_block(path: str, *ops: str) -> str:
    return f"  {path}:\n" + "\n".join(ops)


page20 = "\n".join(
    [qparam("page", "integer", default=1), qparam("pageSize", "integer", default=20)]
)
page50 = "\n".join(
    [qparam("page", "integer", default=1), qparam("pageSize", "integer", default=50)]
)
symbol_opt = qparam("symbol", "string", description="交易对，如 BTC-USDT")
symbol_page = "\n".join([symbol_opt, page50])

blocks: list[str] = []

# Account
blocks.append(
    path_block(
        "/api/v1/account/balances",
        op(
            "get",
            "Account",
            "账户余额",
            params=qparam("accountType", "string", enum=ACCT),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/account/ledger",
        op(
            "get",
            "Account",
            "资金流水",
            params="\n".join(
                [
                    qparam("currency", "string"),
                    qparam("accountType", "string", enum=ACCT),
                    qparam(
                        "type",
                        "string",
                        enum=[
                            "deposit",
                            "withdraw",
                            "trade",
                            "fee",
                            "freeze",
                            "unfreeze",
                            "credit",
                            "transfer",
                        ],
                    ),
                    qparam("page", "integer", default=1),
                    qparam("pageSize", "integer", default=50),
                ]
            ),
        ),
    )
)

# Admin announcements
blocks.append(
    path_block(
        "/api/v1/admin/announcements",
        op("get", "Admin", "公告管理列表", params=page50),
        op(
            "post",
            "Admin",
            "创建公告",
            body_yaml=body(
                {
                    "category": {
                        "type": "string",
                        "enum": ["listing", "maintenance", "risk", "system"],
                    },
                    "titleZh": {"type": "string"},
                    "titleEn": {"type": "string"},
                    "summaryZh": {"type": "string"},
                    "summaryEn": {"type": "string"},
                    "contentZh": {"type": "string"},
                    "contentEn": {"type": "string"},
                    "pinned": {"type": "boolean"},
                    "status": {"type": "integer"},
                },
                required=["category", "titleZh", "titleEn", "contentZh", "contentEn"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/announcements/update",
        op(
            "post",
            "Admin",
            "更新公告",
            body_yaml=body(
                {
                    "id": {"type": "integer"},
                    "category": {
                        "type": "string",
                        "enum": ["listing", "maintenance", "risk", "system"],
                    },
                    "titleZh": {"type": "string"},
                    "titleEn": {"type": "string"},
                    "summaryZh": {"type": "string"},
                    "summaryEn": {"type": "string"},
                    "contentZh": {"type": "string"},
                    "contentEn": {"type": "string"},
                    "pinned": {"type": "boolean"},
                    "status": {"type": "integer"},
                },
                required=["id"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/announcements/remove",
        op(
            "post",
            "Admin",
            "删除公告",
            body_yaml=body({"id": {"type": "integer"}}, required=["id"]),
        ),
    )
)

# Admin deposits / finance / withdraw
blocks.append(
    path_block(
        "/api/v1/admin/deposits/confirm",
        op(
            "post",
            "Admin",
            "确认充币入账",
            body_yaml=body(
                {
                    "userId": {"type": "integer"},
                    "currency": {"type": "string", "example": "USDT"},
                    "chain": {"type": "string", "example": "TRC20"},
                    "amount": {"type": "number"},
                    "txHash": {"type": "string"},
                },
                required=["userId", "currency", "chain", "amount", "txHash"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/finance/credit",
        op(
            "post",
            "Admin",
            "人工上分",
            body_yaml=body(
                {
                    "userId": {"type": "integer"},
                    "currency": {"type": "string"},
                    "amount": {"type": "number"},
                    "remark": {"type": "string"},
                },
                required=["userId", "currency", "amount"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/finance/debit",
        op(
            "post",
            "Admin",
            "人工下分",
            body_yaml=body(
                {
                    "userId": {"type": "integer"},
                    "currency": {"type": "string"},
                    "amount": {"type": "number"},
                    "remark": {"type": "string"},
                },
                required=["userId", "currency", "amount"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/finance/ops",
        op(
            "get",
            "Admin",
            "资金操作日志",
            params="\n".join(
                [
                    qparam("page", "integer", default=1),
                    qparam("pageSize", "integer", default=20),
                    qparam("targetUserId", "integer"),
                    qparam("currency", "string"),
                    qparam("type", "string", enum=["credit", "debit"]),
                ]
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/finance/user-balances",
        op(
            "get",
            "Admin",
            "查询用户余额",
            params=qparam("userId", "integer", True),
        ),
    )
)

# Admin platform
blocks.append(path_block("/api/v1/admin/platform/aml/alerts", op("get", "Admin", "AML 告警列表")))
blocks.append(
    path_block("/api/v1/admin/platform/deposit/scan", op("post", "Admin", "TRC20 充币扫链"))
)
blocks.append(
    path_block("/api/v1/admin/platform/insurance-fund", op("get", "Admin", "保险基金余额"))
)
blocks.append(
    path_block(
        "/api/v1/admin/platform/kyb/review",
        op(
            "post",
            "Admin",
            "审核 KYB",
            body_yaml=body(
                {
                    "userId": {"type": "integer"},
                    "approve": {"type": "boolean"},
                    "reason": {"type": "string"},
                },
                required=["userId"],
            ),
        ),
    )
)
blocks.append(
    path_block("/api/v1/admin/platform/settlement/batches", op("get", "Admin", "清算批次列表"))
)
blocks.append(
    path_block("/api/v1/admin/platform/settlement/run", op("post", "Admin", "执行日终清算"))
)

# Admin support
blocks.append(
    path_block(
        "/api/v1/admin/support/tickets",
        op("get", "Admin", "客服工单列表", params=page50),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/support/reply",
        op(
            "post",
            "Admin",
            "回复工单",
            body_yaml=body(
                {
                    "ticketNo": {"type": "string"},
                    "reply": {"type": "string"},
                    "close": {"type": "boolean"},
                },
                required=["ticketNo", "reply"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/trading-pairs/sync-spot",
        op("post", "Admin", "从币安同步现货交易对"),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/withdrawals/pending",
        op("get", "Admin", "待审提现", params=page50),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/withdrawals/approve",
        op(
            "post",
            "Admin",
            "通过提现",
            body_yaml=body(
                {
                    "withdrawNo": {"type": "string"},
                    "txHash": {"type": "string"},
                },
                required=["withdrawNo"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/admin/withdrawals/reject",
        op(
            "post",
            "Admin",
            "拒绝提现",
            body_yaml=body(
                {
                    "withdrawNo": {"type": "string"},
                    "reason": {"type": "string"},
                },
                required=["withdrawNo"],
            ),
        ),
    )
)

# Announcements public
blocks.append(
    path_block(
        "/api/v1/announcements",
        op(
            "get",
            "Announcements",
            "公告列表",
            security="[]",
            params="\n".join(
                [
                    qparam("page", "integer", default=1),
                    qparam("pageSize", "integer", default=20),
                    qparam("category", "string"),
                ]
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/announcements/{id}",
        op(
            "get",
            "Announcements",
            "公告详情",
            security="[]",
            params=pparam("id"),
        ),
    )
)

# ApiKeys
blocks.append(
    path_block(
        "/api/v1/api-keys",
        op("get", "ApiKeys", "API Key 列表"),
        op(
            "post",
            "ApiKeys",
            "创建 API Key",
            body_yaml=body(
                {
                    "label": {"type": "string"},
                    "permissions": {
                        "type": "string",
                        "description": "权限字符串，如 trade,read",
                    },
                    "ipWhitelist": {"type": "string"},
                    "symbolWhitelist": {"type": "string"},
                },
                required_body=False,
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/api-keys/logs",
        op(
            "get",
            "ApiKeys",
            "API Key 调用日志",
            params=qparam("apiKey", "string", True),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/api-keys/revoke",
        op(
            "post",
            "ApiKeys",
            "吊销 API Key",
            body_yaml=body({"apiKey": {"type": "string"}}, required=["apiKey"]),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/api-keys/update",
        op(
            "post",
            "ApiKeys",
            "更新 API Key",
            body_yaml=body(
                {
                    "apiKey": {"type": "string"},
                    "label": {"type": "string"},
                    "permissions": {"type": "string"},
                    "ipWhitelist": {"type": "string"},
                    "symbolWhitelist": {"type": "string"},
                },
                required=["apiKey"],
            ),
        ),
    )
)

# Auth extras
blocks.append(
    path_block(
        "/api/v1/auth/2fa/status",
        op("get", "Auth", "2FA 状态"),
    )
)
blocks.append(path_block("/api/v1/auth/2fa/setup", op("post", "Auth", "开始绑定 2FA")))
blocks.append(
    path_block(
        "/api/v1/auth/2fa/verify",
        op(
            "post",
            "Auth",
            "确认绑定 2FA",
            body_yaml=body({"code": {"type": "string", "example": "123456"}}, required=["code"]),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/auth/2fa/disable",
        op(
            "post",
            "Auth",
            "关闭 2FA",
            body_yaml=body({"code": {"type": "string"}}, required=["code"]),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/auth/change-password",
        op(
            "post",
            "Auth",
            "修改密码",
            body_yaml=body(
                {
                    "currentPassword": {"type": "string"},
                    "newPassword": {"type": "string"},
                },
                required=["currentPassword", "newPassword"],
            ),
        ),
    )
)
blocks.append(path_block("/api/v1/auth/login-history", op("get", "Auth", "登录历史")))
blocks.append(
    path_block(
        "/api/v1/auth/login/challenge",
        op(
            "post",
            "Auth",
            "登录第一步（密码校验并发码）",
            security="[]",
            body_yaml=body(
                {
                    "email": {"type": "string", "example": "user@example.com"},
                    "password": {"type": "string"},
                },
                required=["email", "password"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/auth/login/verify",
        op(
            "post",
            "Auth",
            "登录第二步（验证码签发会话）",
            security="[]",
            body_yaml=body(
                {
                    "challengeToken": {"type": "string"},
                    "code": {"type": "string", "example": "123456", "description": "6 位数字验证码"},
                },
                required=["challengeToken", "code"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/auth/login/totp",
        op(
            "post",
            "Auth",
            "登录 TOTP 验证",
            security="[]",
            body_yaml=body(
                {
                    "totpToken": {"type": "string"},
                    "code": {"type": "string", "example": "123456"},
                },
                required=["totpToken", "code"],
            ),
        ),
    )
)
blocks.append(path_block("/api/v1/auth/sessions", op("get", "Auth", "会话列表")))
blocks.append(
    path_block(
        "/api/v1/auth/sessions/revoke",
        op(
            "post",
            "Auth",
            "踢掉指定会话",
            body_yaml=body({"id": {"type": "integer"}}, required=["id"]),
        ),
    )
)
blocks.append(
    path_block("/api/v1/auth/sessions/revoke-all", op("post", "Auth", "踢掉全部会话"))
)

# Futures
blocks.append(
    path_block("/api/v1/futures/symbols", op("get", "Futures", "合约交易对列表", security="[]"))
)
blocks.append(
    path_block("/api/v1/futures/mark-prices", op("get", "Futures", "合约标记价格", security="[]"))
)
blocks.append(
    path_block(
        "/api/v1/futures/funding-rate",
        op(
            "get",
            "Futures",
            "资金费率",
            security="[]",
            params=qparam("symbol", "string"),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/futures/order",
        op(
            "post",
            "Futures",
            "合约下单",
            body_yaml=body(
                {
                    "symbol": {"type": "string", "example": "BTC-USDT-SWAP"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "posSide": {"type": "string", "enum": ["long", "short"]},
                    "type": {"type": "string", "enum": ["limit", "market"]},
                    "price": {"type": "number", "nullable": True, "description": "限价单必填"},
                    "quantity": {"type": "number"},
                    "leverage": {"type": "integer", "default": 10},
                    "marginMode": {
                        "type": "string",
                        "enum": ["cross", "isolated"],
                        "default": "cross",
                    },
                    "reduceOnly": {"type": "boolean"},
                },
                required=["symbol", "side", "posSide", "type", "quantity"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/futures/order/cancel",
        op(
            "post",
            "Futures",
            "合约撤单",
            body_yaml=body({"orderNo": {"type": "string"}}, required=["orderNo"]),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/futures/orders/open",
        op("get", "Futures", "合约当前委托", params=symbol_opt),
    )
)
blocks.append(
    path_block(
        "/api/v1/futures/orders/history",
        op("get", "Futures", "合约历史委托", params=symbol_page),
    )
)
blocks.append(path_block("/api/v1/futures/positions", op("get", "Futures", "合约持仓")))
blocks.append(
    path_block(
        "/api/v1/futures/leverage",
        op(
            "post",
            "Futures",
            "设置杠杆",
            body_yaml=body(
                {
                    "symbol": {"type": "string"},
                    "leverage": {"type": "integer", "description": "1-125"},
                },
                required=["symbol", "leverage"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/futures/margin-mode",
        op(
            "post",
            "Futures",
            "设置保证金模式",
            body_yaml=body(
                {
                    "symbol": {"type": "string"},
                    "marginMode": {"type": "string", "enum": ["cross", "isolated"]},
                },
                required=["symbol", "marginMode"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/futures/preference",
        op(
            "get",
            "Futures",
            "合约偏好",
            params=qparam("symbol", "string", True),
        ),
    )
)

# KYC didit
blocks.append(path_block("/api/v1/kyc/config", op("get", "KYC", "KYC 配置", security="[]")))
blocks.append(
    path_block("/api/v1/kyc/didit/config", op("get", "KYC", "Didit 配置", security="[]"))
)
blocks.append(
    path_block(
        "/api/v1/kyc/didit/session",
        op(
            "post",
            "KYC",
            "创建 Didit 会话",
            body_yaml=body(
                {
                    "callbackUrl": {"type": "string", "format": "uri"},
                    "language": {"type": "string"},
                },
                required_body=False,
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/kyc/didit/sync",
        op(
            "post",
            "KYC",
            "同步 Didit 状态",
            body_yaml=body(
                {"sessionId": {"type": "string", "format": "uuid"}},
                required=["sessionId"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/kyc/didit/webhook",
        op(
            "post",
            "KYC",
            "Didit Webhook",
            security="[]",
            body_yaml="""      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: true
              description: Didit 回调原始 payload""",
        ),
    )
)

# Market
blocks.append(
    path_block(
        "/api/v1/market/depth",
        op(
            "get",
            "Market",
            "订单簿深度",
            security="[]",
            params="\n".join(
                [
                    qparam("symbol", "string", True),
                    qparam("exchange", "string"),
                    qparam("limit", "integer", default=50),
                ]
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/market/tickers",
        op(
            "get",
            "Market",
            "多交易对 24h ticker",
            security="[]",
            params="\n".join(
                [
                    qparam("exchange", "string"),
                    qparam("quote", "string", default="USDT"),
                ]
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/market/trades",
        op(
            "get",
            "Market",
            "最近成交",
            security="[]",
            params="\n".join(
                [
                    qparam("symbol", "string", True),
                    qparam("exchange", "string"),
                    qparam("limit", "integer", default=50),
                ]
            ),
        ),
    )
)

# Notifications
blocks.append(
    path_block(
        "/api/v1/notifications",
        op(
            "get",
            "Notifications",
            "通知列表",
            params="\n".join(
                [
                    qparam("page", "integer", default=1),
                    qparam("pageSize", "integer", default=30),
                ]
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/notifications/read",
        op(
            "post",
            "Notifications",
            "标记已读",
            body_yaml=body(
                {
                    "ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "minItems": 1,
                        "description": "通知 ID 列表",
                    }
                },
                required=["ids"],
            ),
        ),
    )
)

# Platform
blocks.append(
    path_block(
        "/api/v1/platform/earn/products",
        op("get", "Platform", "赚币产品列表", security="[]"),
    )
)
blocks.append(
    path_block("/api/v1/platform/earn/positions", op("get", "Platform", "我的赚币仓位"))
)
blocks.append(
    path_block(
        "/api/v1/platform/earn/subscribe",
        op(
            "post",
            "Platform",
            "申购赚币",
            body_yaml=body(
                {
                    "productNo": {"type": "string"},
                    "amount": {"type": "number"},
                },
                required=["productNo", "amount"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/platform/earn/redeem",
        op(
            "post",
            "Platform",
            "赎回赚币",
            body_yaml=body({"positionId": {"type": "integer"}}, required=["positionId"]),
        ),
    )
)
blocks.append(
    path_block("/api/v1/platform/margin/summary", op("get", "Platform", "杠杆负债汇总"))
)
blocks.append(
    path_block(
        "/api/v1/platform/margin/borrow",
        op(
            "post",
            "Platform",
            "杠杆借入",
            body_yaml=body(
                {
                    "currency": {"type": "string"},
                    "amount": {"type": "number"},
                },
                required=["currency", "amount"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/platform/margin/repay",
        op(
            "post",
            "Platform",
            "杠杆还款",
            body_yaml=body({"loanId": {"type": "integer"}}, required=["loanId"]),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/platform/unified/mode",
        op("get", "Platform", "查询统一账户模式"),
        op(
            "post",
            "Platform",
            "切换统一账户模式",
            body_yaml=body(
                {"mode": {"type": "string", "enum": ["classic", "unified"]}},
                required=["mode"],
            ),
        ),
    )
)
blocks.append(
    path_block("/api/v1/platform/unified/equity", op("get", "Platform", "统一账户权益"))
)
blocks.append(
    path_block(
        "/api/v1/platform/options/instruments",
        op("get", "Platform", "期权合约列表", security="[]"),
    )
)
blocks.append(
    path_block("/api/v1/platform/options/positions", op("get", "Platform", "期权持仓"))
)
blocks.append(
    path_block(
        "/api/v1/platform/options/order",
        op(
            "post",
            "Platform",
            "期权下单",
            body_yaml=body(
                {
                    "symbol": {"type": "string"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "quantity": {"type": "number"},
                },
                required=["symbol", "side", "quantity"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/platform/quick-buy/quote",
        op(
            "post",
            "Platform",
            "快捷买报价",
            body_yaml=body(
                {
                    "fiatAmount": {"type": "number"},
                    "crypto": {"type": "string", "default": "USDT"},
                },
                required=["fiatAmount"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/platform/quick-buy/order",
        op(
            "post",
            "Platform",
            "创建快捷买订单",
            body_yaml=body(
                {
                    "fiatAmount": {"type": "number"},
                    "crypto": {"type": "string", "default": "USDT"},
                },
                required=["fiatAmount"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/platform/quick-buy/confirm",
        op(
            "post",
            "Platform",
            "确认快捷买付款",
            body_yaml=body({"orderNo": {"type": "string"}}, required=["orderNo"]),
        ),
    )
)
blocks.append(
    path_block("/api/v1/platform/quick-buy/orders", op("get", "Platform", "快捷买订单列表"))
)
blocks.append(path_block("/api/v1/platform/account/tier", op("get", "Platform", "账户等级")))
blocks.append(
    path_block(
        "/api/v1/platform/kyb/submit",
        op(
            "post",
            "Platform",
            "提交企业 KYB",
            body_yaml=body(
                {
                    "companyName": {"type": "string"},
                    "regNo": {"type": "string"},
                    "contactName": {"type": "string"},
                },
                required=["companyName"],
            ),
        ),
    )
)
blocks.append(path_block("/api/v1/platform/kyb/status", op("get", "Platform", "KYB 状态")))

# Spot
blocks.append(
    path_block("/api/v1/spot/symbols", op("get", "Spot", "现货交易对列表", security="[]"))
)
blocks.append(
    path_block(
        "/api/v1/spot/orderbook",
        op(
            "get",
            "Spot",
            "现货盘口",
            security="[]",
            params="\n".join(
                [
                    qparam("symbol", "string", True, description="交易对，如 BTC-USDT"),
                    qparam("limit", "integer", default=50),
                ]
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/spot/order",
        op(
            "post",
            "Spot",
            "现货下单",
            body_yaml=body(
                {
                    "symbol": {"type": "string", "example": "BTC-USDT"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "type": {"type": "string", "enum": ["limit", "market"]},
                    "timeInForce": {
                        "type": "string",
                        "enum": ["gtc", "post_only", "ioc", "fok"],
                        "default": "gtc",
                    },
                    "price": {
                        "type": "number",
                        "nullable": True,
                        "description": "限价单必填",
                    },
                    "quantity": {"type": "number", "example": 0.01},
                },
                required=["symbol", "side", "type", "quantity"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/spot/order/cancel",
        op(
            "post",
            "Spot",
            "现货撤单",
            body_yaml=body({"orderNo": {"type": "string"}}, required=["orderNo"]),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/spot/order/amend",
        op(
            "post",
            "Spot",
            "现货改单",
            body_yaml=body(
                {
                    "orderNo": {"type": "string"},
                    "price": {"type": "number", "nullable": True},
                    "quantity": {"type": "number"},
                },
                required=["orderNo"],
            ),
        ),
    )
)
blocks.append(
    path_block("/api/v1/spot/orders/open", op("get", "Spot", "现货当前委托", params=symbol_opt))
)
blocks.append(
    path_block("/api/v1/spot/orders/history", op("get", "Spot", "现货历史委托", params=symbol_page))
)
blocks.append(
    path_block("/api/v1/spot/trades", op("get", "Spot", "现货成交记录", params=symbol_page))
)
blocks.append(
    path_block(
        "/api/v1/spot/algo-order",
        op(
            "post",
            "Spot",
            "现货条件单",
            body_yaml=body(
                {
                    "symbol": {"type": "string", "example": "BTC-USDT"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "algoType": {
                        "type": "string",
                        "enum": ["stop_loss", "take_profit", "trailing_stop"],
                    },
                    "triggerPrice": {
                        "type": "number",
                        "description": "trailing_stop 可不填",
                    },
                    "orderPrice": {"type": "number", "nullable": True},
                    "quantity": {"type": "number"},
                    "callbackRate": {
                        "type": "number",
                        "description": "移动止盈回调比例",
                    },
                },
                required=["symbol", "side", "algoType", "quantity"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/spot/algo-order/cancel",
        op(
            "post",
            "Spot",
            "撤销条件单",
            body_yaml=body({"algoNo": {"type": "string"}}, required=["algoNo"]),
        ),
    )
)
blocks.append(
    path_block("/api/v1/spot/algo-orders", op("get", "Spot", "条件单列表", params=symbol_opt))
)
blocks.append(
    path_block(
        "/api/v1/spot/algo-orders/history",
        op("get", "Spot", "条件单历史", params=page20),
    )
)
blocks.append(
    path_block(
        "/api/v1/spot/oco",
        op(
            "post",
            "Spot",
            "OCO 下单",
            body_yaml=body(
                {
                    "symbol": {"type": "string"},
                    "side": {"type": "string", "enum": ["buy", "sell"]},
                    "quantity": {"type": "number"},
                    "takeProfitTrigger": {"type": "number"},
                    "stopLossTrigger": {"type": "number"},
                    "takeProfitOrderPrice": {"type": "number", "nullable": True},
                    "stopLossOrderPrice": {"type": "number", "nullable": True},
                },
                required=[
                    "symbol",
                    "side",
                    "quantity",
                    "takeProfitTrigger",
                    "stopLossTrigger",
                ],
            ),
        ),
    )
)

# Support
blocks.append(
    path_block(
        "/api/v1/support/tickets",
        op("get", "Support", "我的工单列表"),
        op(
            "post",
            "Support",
            "创建工单",
            body_yaml=body(
                {
                    "category": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                },
                required=["subject", "body"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/support/tickets/{ticketNo}",
        op("get", "Support", "工单详情", params=pparam("ticketNo")),
    )
)

# Wallet
blocks.append(path_block("/api/v1/wallet/chains", op("get", "Wallet", "支持链列表")))
blocks.append(
    path_block(
        "/api/v1/wallet/deposit-address",
        op(
            "get",
            "Wallet",
            "充币地址",
            params="\n".join(
                [
                    qparam("currency", "string", True),
                    qparam("chain", "string", True),
                ]
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/wallet/withdraw",
        op(
            "post",
            "Wallet",
            "提币",
            body_yaml=body(
                {
                    "currency": {"type": "string", "example": "USDT"},
                    "chain": {"type": "string", "example": "TRC20"},
                    "amount": {"type": "number"},
                    "address": {"type": "string"},
                    "memo": {"type": "string"},
                },
                required=["currency", "chain", "amount", "address"],
            ),
        ),
    )
)
blocks.append(
    path_block(
        "/api/v1/wallet/transfer",
        op(
            "post",
            "Wallet",
            "资金划转",
            body_yaml=body(
                {
                    "currency": {"type": "string", "example": "USDT"},
                    "amount": {"type": "number"},
                    "fromAccount": {"type": "string", "enum": ACCT},
                    "toAccount": {"type": "string", "enum": ACCT},
                },
                required=["currency", "amount", "fromAccount", "toAccount"],
            ),
        ),
    )
)
blocks.append(
    path_block("/api/v1/wallet/deposits", op("get", "Wallet", "充币记录", params=page20))
)
blocks.append(
    path_block("/api/v1/wallet/withdrawals", op("get", "Wallet", "提币记录", params=page20))
)
blocks.append(
    path_block("/api/v1/wallet/transfers", op("get", "Wallet", "划转记录", params=page20))
)

# Sort by path for stable output
def path_key(block: str) -> str:
    return block.split("\n", 1)[0]


blocks.sort(key=path_key)

header = """
# ---------------------------------------------------------------------------
# 对照后端 validators/controllers 补全请求参数（供 Apifox 导入）
# ---------------------------------------------------------------------------
"""
new_section = header + "\n".join(blocks) + "\n"

text = OA.read_text()
idx = text.find(MARKER)
if idx < 0:
    idx = text.find(MARKER2)
if idx < 0:
    raise SystemExit("marker not found in openapi.yaml")
OA.write_text(text[:idx].rstrip() + "\n" + new_section)
print("paths", len(blocks))
print("properties", new_section.count("properties:"))
print("additionalProperties stubs", new_section.count("additionalProperties: true"))
print("wrote", OA)
