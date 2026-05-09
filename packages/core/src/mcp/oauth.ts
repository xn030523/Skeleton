/**
 * MCP OAuth — OAuth 2.1 PKCE flow for MCP servers requiring authentication.
 *
 * Spins up an ephemeral localhost callback server, opens the authorization
 * endpoint in the user's browser, and exchanges the auth code for tokens
 * using PKCE (code_verifier / code_challenge).
 */

import crypto from "node:crypto";
import http from "node:http";

const DEFAULT_SCOPE = "openid profile email";

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function generateCodeVerifier(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

function deriveCodeChallenge(verifier: string): string {
  return base64URLEncode(crypto.createHash("sha256").update(verifier).digest());
}

function generateState(): string {
  return base64URLEncode(crypto.randomBytes(16));
}

interface OAuthConfig {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scope?: string;
}

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
}

/** Execute an OAuth 2.1 PKCE flow and return tokens */
export async function buildMcpOAuth(config: OAuthConfig): Promise<OAuthTokens> {
  const {
    clientId,
    authorizationEndpoint,
    tokenEndpoint,
    scope = DEFAULT_SCOPE,
  } = config;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);
  const state = generateState();

  const { port, code } = await listenForCallback(state);

  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log(`\n  MCP OAuth: Open this URL in your browser:\n  ${authUrl.toString()}\n`);

  const tokens = await exchangeCodeForTokens(
    tokenEndpoint,
    clientId,
    code,
    redirectUri,
    codeVerifier,
  );

  return tokens;
}

function listenForCallback(expectedState: string): Promise<{ port: number; code: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const cbState = url.searchParams.get("state");

      if (!code || cbState !== expectedState) {
        res.writeHead(400);
        res.end("Invalid callback — state mismatch or missing code");
        server.close();
        reject(new Error("OAuth callback failed: state mismatch or missing code"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h1>Authorization successful!</h1><p>You can close this tab.</p></body></html>");

      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      server.close();
      resolve({ port, code });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;

      console.log(`  MCP OAuth: Listening for callback on http://127.0.0.1:${port}/callback`);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timed out (120s)"));
    }, 120_000);

    server.on("close", () => {
      clearTimeout(timer);
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      server.close();
      reject(err);
    });
  });
}

async function exchangeCodeForTokens(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<OAuthTokens> {
  const resp = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Token exchange failed (${resp.status}): ${body}`);
  }

  const data = await resp.json() as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}
