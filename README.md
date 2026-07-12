# vvi-risk-cli

`vvi-risk-cli` 是给 `vvi-risk` 项目配套的 Node.js CLI。它把常用的 `risk-admin` 只读接口包装成可组合命令，方便在任意仓库里用稳定 JSON 调用。

## 命令面

- `risk-cli --json doctor`
- `risk-cli --json doctor --full`
- `risk-cli login`
- `risk-cli init --base-url ... --token ...`
- `risk-cli models list`
- `risk-cli models get --id 226`
- `risk-cli preitems list --model-id 226`
- `risk-cli datacolumns get --model-id 226 [--display]`
- `risk-cli apps list`
- `risk-cli apps get --id 4`
- `risk-cli app-versions list --app-id 4`
- `risk-cli events search --model-id 226 --field ... --value ... --begin ... --end ...`
- `risk-cli request get /services/v1/model/list`

## 认证与配置

优先级：

推荐先执行：

```bash
risk-cli login
```

该命令会打开风控平台登录页，由风控平台完成 MemHub 登录后把风控服务返回的 `x-auth-token` 回传给本地 CLI，并保存到 `~/.config/vvicat-risk/config.json`。如果浏览器不能自动打开，可使用：

```bash
risk-cli login --no-open
```

配置读取优先级：

1. 命令行参数 `--base-url` / `--token`
2. 环境变量 `RISK_BASE_URL` / `RISK_ADMIN_TOKEN`
3. `~/.config/vvicat-risk/config.json`

风控接口默认使用请求头 `x-auth-token`。

## doctor 诊断

默认诊断只检查 CLI 运行环境、配置来源、服务根地址可达性和 session 鉴权状态，不请求模型、应用、名单等业务列表：

```bash
risk-cli --json doctor
```

需要做完整业务资源诊断时显式加 `--full`。完整版会检查模型列表、应用列表，并按模型检查名单列表：

```bash
risk-cli --json doctor --full
```

## JSON 约定

默认输出是简洁文本。加 `--json` 时：

- 成功输出：
```json
{
  "ok": true,
  "command": "models list",
  "data": {}
}
```

- 失败输出：
```json
{
  "ok": false,
  "error": {
    "message": "无token，请重新登录",
    "code": "601"
  }
}
```

CLI 不会输出完整 token。

## 安装

```bash
git clone https://github.com/liam798/vvi-risk-cli.git
cd vvi-risk-cli
pnpm install
pnpm run install:global
```

## 示例

```bash
risk-cli --json doctor
risk-cli --json doctor --full
risk-cli login
risk-cli --json models list
risk-cli --json datacolumns get --model-id 226
```
