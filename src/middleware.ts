import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// 常量时间比较函数，对等长输入实现常数时间比较（防范时序攻击）
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// 辅助函数：使用 Web Crypto API 生成 SHA-256 哈希签名
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const accessToken = process.env.ACCESS_TOKEN;

  // 如果未配置密钥，则不启用任何拦截，确保向后兼容与默认行为一致
  if (!accessToken) {
    return NextResponse.next();
  }

  // =================================================================
  // 1. 白名单策略：放行公开静态资源、脚本与 skipAuth API
  // =================================================================

  // A. 放行基础静态资源（不含敏感 Umami 特征且 matcher 无法排除的）
  // 特别注意：此处已移除 /_next/ 全路径放行，防止通过 /_next/data/ 泄露后台 RSC 数据结构。
  // matcher 已排除 _next/static 和 _next/image。
  if (pathname.startsWith('/static/') || pathname === '/robots.txt') {
    return NextResponse.next();
  }

  // B. 放行统计脚本与录制脚本（支持自定义脚本名称）
  const trackerScripts = ['/script.js', '/telemetry.js', '/recorder.js'];
  const envTrackerScriptName = process.env.TRACKER_SCRIPT_NAME;
  if (envTrackerScriptName) {
    envTrackerScriptName.split(',').forEach(name => {
      const trimmed = name.trim();
      if (trimmed) {
        trackerScripts.push(`/${trimmed.replace(/^\/+/, '')}`);
      }
    });
  }

  if (trackerScripts.includes(pathname)) {
    return NextResponse.next();
  }

  // C. 放行公开收集、配置、录制与监控服务 API
  const collectEndpoints = [
    '/api/send',
    '/api/config',
    '/api/batch',
    '/api/record',
    '/api/heartbeat',
  ];
  const envCollectEndpoint = process.env.COLLECT_API_ENDPOINT;
  if (envCollectEndpoint) {
    collectEndpoints.push(`/${envCollectEndpoint.replace(/^\/+/, '')}`);
  }

  if (collectEndpoints.includes(pathname)) {
    return NextResponse.next();
  }

  // =================================================================
  // 2. 身份验证策略：保护管理面板、登录接口与配置路径
  // =================================================================

  const tokenQuery =
    searchParams.get('token') || searchParams.get('key') || searchParams.get('secret');
  const tokenCookie = request.cookies.get('umami_access_token')?.value;

  // 校验 A：URL 中携带了正确的密钥（如 ?secret=xxx）
  if (tokenQuery && constantTimeEqual(tokenQuery, accessToken)) {
    // 构造无敏感参数 of URL，纯净化地址栏
    const url = request.nextUrl.clone();
    url.searchParams.delete('token');
    url.searchParams.delete('key');
    url.searchParams.delete('secret');

    const response = NextResponse.redirect(url);

    // 生成基于时间戳和 ACCESS_TOKEN 的加密签名，防 Cookie 伪造
    const timestamp = Date.now().toString();
    const signature = await sha256(`${timestamp}:${accessToken}`);
    const cookieValue = `${timestamp}:${signature}`;

    // 写入安全鉴权 Cookie，有效期 1 年
    response.cookies.set('umami_access_token', cookieValue, {
      path: '/',
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:', // 动态支持本地非 HTTPS 开发环境
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  }

  // 校验 B：Cookie 中包含有效的加密鉴权签名，且未过期
  if (tokenCookie) {
    const parts = tokenCookie.split(':');
    if (parts.length === 2) {
      const [timestamp, signature] = parts;

      // 服务端强制校验时间戳有效期（防止凭证泄露后无限期重放，限制为 1 年）
      const parsedTime = Number.parseInt(timestamp, 10);
      const isExpired =
        Number.isNaN(parsedTime) || Date.now() - parsedTime > 365 * 24 * 60 * 60 * 1000;

      if (!isExpired) {
        const expectedSignature = await sha256(`${timestamp}:${accessToken}`);

        if (constantTimeEqual(signature, expectedSignature)) {
          return NextResponse.next();
        }
      }
    }
  }

  // =================================================================
  // 3. 拦截策略：对未授权请求返回标准无特征的 404 页面
  // =================================================================
  return new NextResponse(
    `<!DOCTYPE html>
<html>
<head>
  <title>404 Not Found</title>
  <meta name="robots" content="noindex,nofollow" />
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #fafafa; color: #333; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; flex-direction: column;">
  <h1 style="font-size: 50px; font-weight: 300; margin: 0;">404</h1>
  <p style="font-size: 14px; color: #666; margin-top: 10px;">The requested URL was not found on this server.</p>
</body>
</html>`,
    {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}

export const config = {
  // 匹配除特定静态路径外的路由
  matcher: ['/((?!_next/static|_next/image).*)'],
};
