# Umami 隐蔽式安全访问控制（防 FOFA / Shodan 扫描）文档

为了防止你的自建 Umami 实例被网络空间资产搜索引擎（如 FOFA、Shodan、Censys 等）抓取并识别出后台登录界面，本项目在本地分支中引入了**隐蔽式访问控制机制（Stealth Access Control）**。

本文档用于记录该改动的核心原理、配置步骤、潜在安全风险与后续维护说明，以防日后遗忘。

---

## 🔒 核心设计原理

本功能通过 Next.js 的 **Edge Middleware（边缘中间件）** 在网络请求的第一时间进行安全拦截，具有**完全隐形**和**零 Git 冲突**的核心优势：

### 1. 拦截与完全隐形（Stealth Mode）
* **对于未授权请求（包括所有扫描器、机器人和普通人）**：
  只要访问不包含正确的密钥或加密授权 Cookie，中间件将直接拦截请求，并立刻响应一个标准、极简的 `404 Not Found` 页面。
  * 响应状态码为 `404`。
  * 响应的 HTML 中**不包含任何 Umami 特有字样、样式、JS 依赖或 Favicon 散列值**。
  * FOFA 等扫描器在抓取时会判定此端口或域名「无任何已知资产运行」，从而实现 100% 隐藏登录界面。
* **对于公开统计脚本与接口（白名单放行）**：
  精准放行数据统计、参数获取与系统健康度相关的必要公开 API（即上游 `skipAuth: true` 的开放路由），保证你的博客或网站流量收集、录制与监控完全不受影响：
  * 原生及自定义统计脚本：`/script.js`、`/telemetry.js` 以及环境变量 `TRACKER_SCRIPT_NAME` 定义的任何混淆脚本名。
  * 原生及自定义收集 API 接口：`/api/send` 以及环境变量 `COLLECT_API_ENDPOINT` 定义的端点。
  * 上游核心公开服务接口：
    *   `/api/config`（用于统计脚本在客户端拉取配置，如自定义脚本名）
    *   `/api/batch`（用于批量提交数据）
    *   `/api/record`（用于会话录制数据提交）
    *   `/api/heartbeat`（用于系统健康度探针与外部可用性监控）
  * 基础静态资源：放行`/static/...`、`/robots.txt`。
  * **🚨 安全优化**：**已移除对整个 `/_next/` 全路径的通配放行**。系统已排除 `_next/static` 和 `_next/image` 等静态目录，任何请求 `/_next/data/...` 以获取后台 RSC (React Server Components) 数据结构的未授权尝试都会被中间件无条件拦截，彻底杜绝数据结构泄露。

### 2. 密码学安全防线
* **加密签名校验（Web Crypto API）**：
  Cookie 值格式为 `时间戳:哈希签名`（`${timestamp}:${signature}`），其中哈希签名由 `${timestamp}:${ACCESS_TOKEN}` 经由 SHA-256 计算得出。由于攻击者不知道 `ACCESS_TOKEN`，因而绝对无法伪造此 Cookie。
* **服务端过期校验（Anti-Replay）**：
  不仅依赖浏览器侧的 `maxAge` 过期控制，**中间件在服务端会强制校验 Cookie 中时间戳的合法性**。被盗的 Cookie 一旦超过 **365 天（1 年）**，即使签名正确也会被立刻拒绝并作废，防范重放攻击。
* **防范时序攻击（Timing Attack Protection）**：
  密钥比对与签名校验均使用「常数时间比较算法（Constant-Time Comparison）」，避免通过分析比对耗时的微妙差异逆向破解密钥。
* **动态 Secure 机制**：
  当处于 HTTPS 生产环境时，Cookie 自动启用 `secure: true` 传输；在非 HTTPS 环境下（如本地开发 `http://localhost`）则动态关闭，确保本地调试的便利性。

### 3. 零冲突升级机制（100% 兼容上游 Fork 更新）
* 本次改动**未修改任何上游已有文件**（如 `layout.tsx`、`vercel.json` 等）。
* 我们仅新增了两个完全独立的文件：`src/middleware.ts`（中间件逻辑）和 `STEALTH_ACCESS.md`（本文档）。
* 在你以后自动同步拉取官方上游更新时，Git 会将其视作本地独有的新增文件自动合并，**绝不会触发任何合并冲突（Merge Conflict）**。

---

## ⚠️ 安全风险披露与缓释方案

> [!WARNING]
> ### 1. 密钥通过 URL 参数传递的风险（Log Exposure）
> * **风险说明**：首次访问时，你需要通过类似 `?secret=xxx` 的参数传递密钥。虽然中间件在成功验证后会**立刻进行重定向并抹去 URL 中的参数**，但在重定向发生前，该请求可能已经被边缘代理服务器、CDN、WAF 或反向代理的访问日志（Access Logs）明文记录下来。
> * **缓释方案**：
>   * 设置并使用高熵（复杂且长）的 `ACCESS_TOKEN` 密钥。
>   * 在信任的个人网络环境下进行首次配置和授权绑定。
>   * 定期在 Vercel 环境变量中对密钥进行轮换。
>   * 如果你配置了外部 CDN，可调低或关闭其访问日志的留存时间。

> [!IMPORTANT]
> ### 2. 暴力破解风险（Brute-Force Attack）
> * **风险说明**：由于中间件完全无状态且独立，外界恶意用户可以持续尝试不同的 `?secret=` 值对你的实例进行爆破攻击。
> * **缓释方案**：
>   * **强烈建议启用 Vercel WAF 速率限制（Rate Limiting）**。在 Vercel 仪表板中，你可以对 `/` 等动态路由免费创建速率限制规则。一旦发现短时间内产生大量非 200/404 状态的异常请求，Vercel 边缘节点会自动阻断攻击者 IP，从平台层完美抵御爆破。

---

## ⚙️ 部署与启用步骤

### 第一步：在 Vercel 中添加环境变量
1. 登录你的 [Vercel Dashboard](https://vercel.com)。
2. 进入你的 Umami 统计项目，依次点击 **Settings -> Environment Variables**。
3. 添加一个新的环境变量：
   * **Key**: `ACCESS_TOKEN`
   * **Value**: `【你自定义的高强度安全密钥】`（例如：`MySecretToken2026`）
4. 保存该变量并在 **Deployments** 选项卡下点击 **Redeploy** 重新部署。

---

## 🔑 日常使用与鉴权方法

### 1. 首次访问
在地址栏中输入你的域名并附带密钥参数（支持 `secret`、`key` 或 `token`）：
```text
https://你的域名.com/?secret=你的安全密钥
```
验证成功后，页面会自动重定向纯净化 URL，并写入长效 Cookie。

### 2. 后续访问
直接访问你的主域名即可直接登录，无需再附带任何参数：
```text
https://你的域名.com/
```

---

## 🛠️ 后续维护与卸载说明

* **如何恢复默认（彻底卸载该功能）**：
  若想完全恢复到官方默认状态，只需在 Git 仓库中**直接删除** `src/middleware.ts` 文件，或在 Vercel 中删除 `ACCESS_TOKEN` 环境变量，并重新部署即可。
