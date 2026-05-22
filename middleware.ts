import createMiddleware from 'next-intl/middleware';

export default createMiddleware({
  locales:       ['zh', 'en'],
  defaultLocale: 'zh',
});

export const config = {
  // Match all pathnames except for API routes, static files, and Next.js internals
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};