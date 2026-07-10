import NextAuth, { type NextAuthOptions, type DefaultSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { query } from '@/lib/db';

declare module 'next-auth' {
  interface Session {
    user: {
      email: string;
    } & DefaultSession['user'];
  }
}

interface UserRow {
  id: number;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge:   30 * 24 * 60 * 60,
  },
  callbacks: {
    // Runs every time someone signs in. Creates the matching row in our own
    // `users` table the first time (ON CONFLICT DO NOTHING keeps it a no-op
    // on every later sign-in). Without this, someone can authenticate with
    // Google successfully but every feature that looks them up in our own
    // database (watchlist, etc.) fails with "User not found".
    async signIn({ user }) {
      if (!user?.email) return false;
      try {
        await query<UserRow>`
          INSERT INTO users (email, name)
          VALUES (${user.email}, ${user.name ?? null})
          ON CONFLICT (email) DO NOTHING
        `;
      } catch (err) {
        console.error('[auth] Failed to upsert user row:', err);
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },
    async session({ session, token }) {
      if (token.email && session.user) session.user.email = token.email as string;
      return session;
    },
  },
  // No custom sign-in page — '/login' was configured here previously, but
  // that page was never actually built anywhere in the app, which is why
  // NextAuth's own redirects to it occasionally 404'd. Removing this lets
  // NextAuth fall back to its own built-in handling instead.
};

export default NextAuth(authOptions);