# Motive · Azure VM 部署

## 目标环境与验证范围

仓库提供 Azure VM 部署配置。代码测试使用替身 SDK 客户端，**不代表真实模型调用或远程部署已经通过验证**。上线前须在目标环境安装依赖、完成 Copilot 登录，并执行本文中的真实生成检查。服务器地址、私钥和运行凭据应保存在仓库之外，或放入已忽略的本地运行目录。

以下针对已有 Linux VM 与 Docker Compose；Windows VM 需另选运行环境。默认只绑定 VM 本机的 4173，通过 SSH 隧道访问；端口被占用时可在准备命令中指定其他 loopback 端口。脚本不修改其他网站、网关、Azure NSG 或防火墙。

## 1. 发布包与构建

本地运行 `./scripts/package-release.ps1`，将 `artifacts/` 中的 `.tar.gz` 和 `.sha256` 上传到选定 VM 的独立目录，例如 `~/motive`。核对摘要后解压，包不包含凭据、客户浏览器数据或依赖目录。

VM 需有已授权 SSH 访问、Docker Engine/Compose、OpenSSL，以及到 npm 和 GitHub Copilot 的出站网络。进入项目根目录：

```sh
bash deploy/prepare.sh http://127.0.0.1:4173
docker compose --env-file .deploy.env build
```

若 4173 已被占用，可改用其他仅绑定 loopback 的端口，例如 `bash deploy/prepare.sh http://127.0.0.1:4174`。脚本会同步设置 `PUBLIC_ORIGIN` 与 `MOTIVE_HOST_PORT`，并为仅通过 SSH 隧道访问的回环来源设置 `MOTIVE_AUTH_MODE=none`，打开页面即可直接进入。无密码模式不能用于公网来源。

脚本从 npm 查询 SDK/CLI 版本并保存在 `.deploy.env`，构建使用确切版本；默认选择 `gpt-6-astra`，组织管理员必须已在 Copilot 模型策略中启用该模型。可在构建前改为组织已验证的 SDK、CLI 和模型版本。源码适配层依据已知 SDK 接口编写，真实兼容性必须通过下一步检查确认。

脚本生成随机工作区密码，保存在 `.private/workspace-password`，不会输出。目录权限 0700，文件通过 Docker secret 挂载，不写入镜像。已存在的 `.deploy.env` 保持不变。Copilot 身份保存在独立持久卷 `copilot_home`，CLI 解包缓存保存在 `copilot_cache`；应用根文件系统仍保持只读。

## 2. 登录 Copilot 并验证真实调用

```sh
docker compose --env-file .deploy.env run --rm app copilot
```

按 CLI 登录提示操作，必要时在交互界面输入 `/login`。使用有 Copilot 权限的账户；登录信息保存在服务账户持久卷。不要将令牌写入前端、镜像、发布包或聊天。

```sh
docker compose --env-file .deploy.env run --rm app node scripts/check-copilot.mjs --generate
```

应看到 `ready: true`、`ok: true`、`engine: copilot` 和有效内容模块数。检查只发送自带的虚构 Sarah 资料。依赖、认证或输出格式不兼容会以非零状态退出；先修正再上线，不能用健康接口替代模型验证。

## 3. 启动与访问

```sh
docker compose --env-file .deploy.env up -d
docker compose --env-file .deploy.env ps
curl --fail http://127.0.0.1:4173/healthz
```

端口占用时为本应用另选端口，同时修改端口映射、PUBLIC_ORIGIN 与隧道；不要停止不相关服务。本地使用实际 SSH 主机别名建立隧道：

```sh
ssh -N -L 4173:127.0.0.1:4173 <你的SSH主机别名>
```

打开 `http://127.0.0.1:4173`。SSH 隧道部署会直接进入工作区；公网 HTTPS 部署仍使用 VM 上 `.private/workspace-password` 中的密码登录。进入设置检查连接，生成一次跟进与活动包，验证文案、独立海报、修改后重新审核以及 PNG/SVG 下载。

## 4. HTTPS 域名（可选）

将已确认的 DNS 域名指向 VM；把 `.deploy.env` 中的 PUBLIC_ORIGIN 改为实际 `https://域名`，MOTIVE_DOMAIN 改为同一域名。

已有 Nginx/Caddy 时，给该域名添加反代到 `127.0.0.1:4173`，保留 Host，不替换其他网站。只有 80/443 可以给此站点使用时才启用附带网关：

```sh
docker compose --env-file .deploy.env -f compose.yaml -f compose.tls.yaml up -d
```

DNS、NSG/防火墙与证书签发需在真实环境验证。公网使用 HTTPS；应用按 PUBLIC_ORIGIN 校验来源，并启用 Secure 会话 Cookie。

## 5. 发布记录与回退

### 升级到 1.3

升级保留 `.deploy.env`、`.private/`、`copilot_home` 和 `copilot_cache`，不要重新登录或删除持久卷。发布分支包含连续对话页面、`/api/chat` 以及既有免登录、宿主端口和 CLI 缓存配置。保留旧镜像，使用新的 `MOTIVE_RELEASE` 构建，成功后再替换应用容器。

若已有 Cloudflare 隧道转发至 Nginx `127.0.0.1:4175`，应用继续绑定 `127.0.0.1:4174`。`deploy/nginx-tunnel.conf` 为这一路径提供配置：`/api/chat` 与 `/api/generate` 共用限流，代理等待时间为 150 秒，避免先于 120 秒模型超时截断请求。该配置依赖仅绑定回环地址的受信任代理，会改写 Host/Origin，不适用于直接公网监听；所有匿名访问者均可消耗配置账户的模型额度，限流不能替代身份认证。

在已有对应站点的 VM 上，先备份 `/etc/nginx/conf.d/motive-tunnel.conf`，将仓库中的配置安装至同一路径，执行 `nginx -t` 成功后 reload Nginx。不要重启 Cloudflare 隧道；Quick Tunnel 在进程重启后可能更换链接。新版本应通过原公网入口分别执行普通对话和交付物生成。

### 对话格式与实时执行过程

前端使用锁定版本的 Marked 模块渲染回复，构建和发布包必须同时包含 `markdown.js`、`execution.js`、`package-lock.json`。服务器只开放 Marked 的单个浏览器模块，不开放整个 `node_modules`。

`/api/chat` 与 `/api/generate` 保留原 JSON 接口；请求头 `Accept: application/x-ndjson` 启用逐行 JSON 事件流。公开事件为 `progress`、`reply`、`heartbeat`、`result` 和 `error`，每条以换行结束。只有 `result` 是最终已校验结果；HTTP 200 仅表示流已建立，仍需处理流内 `error`。聊天只提取顶层 `reply` 字段，交付物生成只显示进度，完整成果经校验后一起返回。SDK 私有推理、工具参数和原始事件对象均不转发。

Copilot 会话需要支持 `streaming: true` 及事件订阅；当前 Azure 运行版本为 SDK 1.0.13 / CLI 1.0.83。代码不会把缺少实时事件支持的 SDK 悄悄降级为假进度。代理必须关闭响应缓冲、缓存及流压缩；模板已设置 `proxy_buffering off`、`proxy_cache off`、`gzip off`，应用返回 `X-Accel-Buffering: no`，等待期间每 10 秒发送心跳。其他入口代理也需允许长连接，不能等收齐回复才转发。

上线时通过实际公网入口确认：最终结果前已收到进度与回答片段；普通问答和成果生成均能完成；停止或断网不会将未完成草稿标记为成功。

保存 `.deploy.env` 的发行标签、镜像 ID 及实际依赖锁文件：

```sh
docker compose --env-file .deploy.env images
docker compose --env-file .deploy.env cp app:/app/package-lock.json .private/deployed-package-lock.json
```

升级时在独立目录解压和构建，保留旧镜像与标签。回退时恢复旧 MOTIVE_RELEASE，再执行 `docker compose --env-file .deploy.env up -d --no-build`。启用 HTTPS 后每次保持相同两个 `-f` 参数。不要删除 Copilot/Caddy 持久卷。

## 范围与验证

目前为单工作区试点架构：共享访问密码、浏览器本地业务数据、浏览器日程检查。没有多用户隔离、服务器客户数据库、后台持续任务或消息发送渠道。重启清除 Web 登录会话，但持久卷保留 Copilot 身份。重要交付物应导出备份。

本地测试、Compose 配置校验与海报图片生成不能替代上线验收。每次发布都需在目标环境确认镜像、SDK/CLI 登录、真实聊天与生成接口，并从实际公网入口检查页面和浏览器下载。
