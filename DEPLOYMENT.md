# Motive · Azure VM 部署

## 目标环境与验证范围

仓库提供 Azure VM 部署配置。代码测试使用替身 SDK 客户端，**不代表真实模型调用或远程部署已经通过验证**。上线前须在目标环境安装依赖、完成 Copilot 登录，并执行本文中的真实生成检查。服务器地址、私钥和运行凭据应保存在仓库之外，或放入已忽略的本地运行目录。

以下针对已有 Linux VM 与 Docker Compose；Windows VM 需另选运行环境。默认只绑定 VM 本机的 4173，通过 SSH 隧道访问。脚本不修改其他网站、网关、Azure NSG 或防火墙。

## 1. 发布包与构建

本地运行 `./scripts/package-release.ps1`，将 `artifacts/` 中的 `.zip` 和 `.zip.sha256` 上传到选定 VM 的独立目录，例如 `~/motive`。用 `sha256sum -c <包名>.zip.sha256` 核对摘要，再用 `unzip <包名>.zip` 解压。包不包含凭据、客户浏览器数据或依赖目录；`RELEASE.json` 包含文件哈希及打包时的真实模型验证状态。

VM 需有已授权 SSH 访问、Docker Engine/Compose、OpenSSL，以及到 npm 和 GitHub Copilot 的出站网络。进入项目根目录：

```sh
bash deploy/prepare.sh http://127.0.0.1:4173
docker compose --env-file .deploy.env build
```

脚本从 `package.json` 读取已锁定的 SDK/CLI 版本并保存在 `.deploy.env`。镜像通过 `npm ci` 使用已提交的 `package-lock.json`，构建参数必须与依赖声明一致；升级依赖应同时更新声明、锁文件和部署配置，不能仅将部署参数改为 `latest`。

脚本生成随机工作区密码，保存在 `.private/workspace-password`，不会输出。目录权限 0700，文件通过 Docker secret 挂载，不写入镜像。已存在的 `.deploy.env` 保持不变。Copilot 身份和缓存分别保存在独立持久卷 `copilot_home`、`copilot_cache`；升级或回退不能删除这些卷。

已明确选择公开免登录访问的部署可设置 `MOTIVE_AUTH_MODE=none`，默认仍为 `password`。`MOTIVE_HOST_PORT` 控制 VM 回环端口，须与 `PUBLIC_ORIGIN` 及既有反代一致。已有公网隧道的升级保留原 Nginx/隧道服务及域名；`deploy/nginx-tunnel.conf` 为关闭聊天流式缓冲的参考配置。公开试点不要接入真实 CRM 客户数据库或添加外发工具。

## 2. 登录 Copilot 并验证真实调用

```sh
docker compose --env-file .deploy.env run --rm app npm run login:copilot
```

按 CLI 登录提示操作，必要时在交互界面输入 `/login`。使用有 Copilot 权限的账户；登录信息保存在服务账户持久卷。不要将令牌写入前端、镜像、发布包或聊天。

```sh
docker compose --env-file .deploy.env run --rm app npm run verify:copilot
```

应看到顶层 `ok: true`、五项检查均为 `ok: true`，包括普通对话、短话术、销售对话整理画像、任务识别与方案海报。检查只使用自带虚构资料，最多调用模型五次，可能计入账户用量。依赖、认证或输出格式不兼容会以非零状态退出；先修正再上线，不能用健康接口替代模型验证。容器以只读文件系统运行，检查报告写到 `/tmp` 并完整输出到终端。

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

打开 `http://127.0.0.1:4173`，用 VM 上 `.private/workspace-password` 中的密码登录。进入设置检查连接，生成一次跟进与活动包，验证文案、独立海报、修改后重新审核以及 PNG/SVG 下载。

## 4. HTTPS 域名（可选）

将已确认的 DNS 域名指向 VM；把 `.deploy.env` 中的 PUBLIC_ORIGIN 改为实际 `https://域名`，MOTIVE_DOMAIN 改为同一域名。

已有 Nginx/Caddy 时，给该域名添加反代到 `127.0.0.1:4173`，保留 Host，不替换其他网站。只有 80/443 可以给此站点使用时才启用附带网关：

```sh
docker compose --env-file .deploy.env -f compose.yaml -f compose.tls.yaml up -d
```

DNS、NSG/防火墙与证书签发需在真实环境验证。公网使用 HTTPS；应用按 PUBLIC_ORIGIN 校验来源，并启用 Secure 会话 Cookie。

## 5. 发布记录与回退

保存 `.deploy.env` 的发行标签、镜像 ID 及实际依赖锁文件：

```sh
docker compose --env-file .deploy.env images
docker compose --env-file .deploy.env cp app:/app/package-lock.json .private/deployed-package-lock.json
```

升级时在独立目录解压和构建，保留旧镜像与标签。回退时恢复旧 MOTIVE_RELEASE，再执行 `docker compose --env-file .deploy.env up -d --no-build`。启用 HTTPS 后每次保持相同两个 `-f` 参数。不要删除 Copilot/Caddy 持久卷。

## 范围与验证

目前为单工作区试点架构：共享访问密码、浏览器本地业务数据、浏览器日程检查。没有多用户隔离、服务器客户数据库、后台持续任务或消息发送渠道。重启清除 Web 登录会话，但持久卷保留 Copilot 身份。重要交付物应导出备份。

源码测试覆盖 SDK 会话、取消和超时、配置与身份加载、业务规则、UI 控制器、HTTP 服务与流式展示；替身模型不能证明真实联网调用。原始源码包的连接状态只是打包时记录。实际部署应单独记录镜像、Git 提交、真实调用结果和可回退的上一版配置。
