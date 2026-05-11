import NextAuth, { type DefaultSession } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

// Read at module init but don't crash the bundle when missing — Next collects
// page data at build time with no env, so a hard throw here breaks `next build`.
// The runtime guard inside the provider config handles a misconfigured
// environment (NextAuth surfaces a clear error on first request).
const keycloakIssuer = process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/pms';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    tenantId?: string;
    roles?: string[];
    user: { name?: string | null; email?: string | null } & DefaultSession['user'];
  }
  interface JWT {
    accessToken?: string;
    tenantId?: string;
    roles?: string[];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? 'pms-web',
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
        // account.expires_at viene en segundos UNIX. Lo convertimos a ms para
        // comparar con Date.now().
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

      // Si el access_token sigue valido (con 30s de margen), reutilizamos.
      const expiresAt = typeof t.accessTokenExpiresAt === 'number' ? t.accessTokenExpiresAt : 0;
      if (Date.now() < expiresAt - 30_000) {
        return token;
      }

      // Caducado: intenta refresh contra Keycloak.
      if (typeof t.refreshToken === 'string') {
        try {
          const res = await fetch(`${keycloakIssuer}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'pms-web',
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
          // 401/400 → refresh inválido (caducado o revocado). Marca token
          // como invalido para que la session devuelva null y middleware
          // redirija a /login.
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
        // Provoca que getServerSession devuelva null → middleware redirige.
        return { ...session, accessToken: undefined, tenantId: undefined, roles: undefined };
      }
      session.accessToken = t.accessToken;
      session.tenantId = t.tenantId;
      session.roles = t.roles;
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
