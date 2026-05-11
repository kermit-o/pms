import NextAuth, { type DefaultSession } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

// Same pattern as web-fo: defer the env check so `next build` collects page
// data without crashing. Misconfigured prod env still surfaces a clear error
// from NextAuth on the first real request.
const keycloakIssuer = process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/pms';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    tenantId?: string;
    roles?: string[];
    user: { name?: string | null; email?: string | null } & DefaultSession['user'];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? 'pms-hsk',
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      issuer: keycloakIssuer,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      const t = token as Record<string, unknown>;
      if (account?.access_token) {
        t.accessToken = account.access_token;
        t.refreshToken = account.refresh_token;
        t.accessTokenExpiresAt =
          typeof account.expires_at === 'number'
            ? account.expires_at * 1000
            : Date.now() + 60 * 1000;
      }
      if (profile && typeof profile === 'object') {
        const claims = profile as Record<string, unknown>;
        if (typeof claims.tenant_id === 'string') {
          t.tenantId = claims.tenant_id;
        }
        const realmAccess = claims.realm_access as { roles?: string[] } | undefined;
        if (Array.isArray(realmAccess?.roles)) {
          t.roles = realmAccess.roles;
        }
      }

      const expiresAt = typeof t.accessTokenExpiresAt === 'number' ? t.accessTokenExpiresAt : 0;
      if (Date.now() < expiresAt - 30_000) {
        return token;
      }

      if (typeof t.refreshToken === 'string') {
        try {
          const res = await fetch(`${keycloakIssuer}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'pms-hsk',
              client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? '',
              refresh_token: t.refreshToken,
            }),
          });
          if (res.ok) {
            const refreshed = (await res.json()) as {
              access_token: string;
              expires_in: number;
              refresh_token?: string;
            };
            t.accessToken = refreshed.access_token;
            t.accessTokenExpiresAt = Date.now() + refreshed.expires_in * 1000;
            if (refreshed.refresh_token) t.refreshToken = refreshed.refresh_token;
            return token;
          }
          t.error = 'RefreshTokenError';
        } catch {
          t.error = 'RefreshTokenError';
        }
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as {
        accessToken?: string;
        tenantId?: string;
        roles?: string[];
        error?: string;
      };
      if (t.error === 'RefreshTokenError') {
        return { ...session, accessToken: undefined, tenantId: undefined, roles: undefined };
      }
      session.accessToken = t.accessToken;
      session.tenantId = t.tenantId;
      session.roles = t.roles;
      return session;
    },
  },
  pages: { signIn: '/login' },
});
