import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const accessToken = process.env.ACCESS_TOKEN;

  // 如果未配置密钥，则不启用任何拦截，确保向后兼容与默认行为一致
  if (!accessToken) {
    return NextResponse.next();
  }

  // =================================================================
  // 1. 白名单策略：允许公开访问的静态资源与统计相关路由
  // =================================================================

  // A. 基础静态资源（不包含敏感的 Umami 特征）
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next();
  }

  // B. 放行统计脚本（支持自定义脚本名称，避免广告拦截）
  const trackerScripts = ['/script.js', '/telemetry.js'];
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

  // C. 放行数据收集接口（支持自定义 API 端点）
  const collectEndpoints = ['/api/send', '/api/collect'];
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
  if (tokenQuery === accessToken) {
    // 构造无敏感参数的 URL，纯净化地址栏
    const url = request.nextUrl.clone();
    url.searchParams.delete('token');
    url.searchParams.delete('key');
    url.searchParams.delete('secret');

    const response = NextResponse.redirect(url);

    // 写入安全鉴权 Cookie，有效期 1 年
    response.cookies.set('umami_access_token', '1', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  }

  // 校验 B：Cookie 中包含有效的鉴权状态
  if (tokenCookie === '1') {
    return NextResponse.next();
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
      },
    },
  );
}

export const config = {
  // 匹配除特定静态路径外的路由
  matcher: ['/((?!_next/static|_next/image).*)'],
};
