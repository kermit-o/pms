import NextAuth, { type DefaultSession } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

const keycloakIssuer = process.env.KEYCLOAK_ISSUER;
if (!keycloakIssuer) {
  throw new Error(
    'KEYCLOAK_ISSUER not set (e.g. http://localhost:8080/realms/pms)',
  );
}

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
      }
      if (profile && typeof profile === 'object') {
        const claims = profile as Record<string, unknown>;
        if (typeof claims.tenant_id === 'string') {
          t.tenantId = claims.tenant_id;
        }
        const realmAccess = claims.realm_access as
          | { roles?: string[] }
          | undefined;
        if (Array.isArray(realmAccess?.roles)) {
          t.roles = realmAccess.roles;
        }
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as {
        accessToken?: string;
        tenantId?: string;
        roles?: string[];
      };
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
