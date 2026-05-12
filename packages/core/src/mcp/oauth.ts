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

// ── OAuthTokenManager — persistent token storage + auto-refresh ──────────
// Port of Hermes HermesTokenStorage + OAuthClientProvider refresh logic.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TOKEN_DIR = path.join(os.homedir(), ".skeleton", "mcp-tokens");

function safeFilename(name: string): string {
  return name.replace(/[^\w-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 128) || "default";
}

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;  // Unix ms
  tokenEndpoint?: string;
  clientId?: string;
}

export class OAuthTokenManager {
  private serverName: string;
  private tokenPath: string;
  private tokens: StoredTokens | null = null;

  constructor(serverName: string) {
    this.serverName = serverName;
    this.tokenPath = path.join(TOKEN_DIR, `${safeFilename(serverName)}.json`);
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.tokenPath)) {
        this.tokens = JSON.parse(fs.readFileSync(this.tokenPath, "utf-8"));
      }
    } catch { /* corrupt file — start fresh */ }
  }

  private save(): void {
    try {
      fs.mkdirSync(TOKEN_DIR, { recursive: true });
      const tmp = this.tokenPath + `.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(this.tokens, null, 2), { encoding: "utf-8", mode: 0o600 });
      fs.renameSync(tmp, this.tokenPath);
    } catch { /* non-critical */ }
  }

  /** Store tokens after initial OAuth flow or refresh. */
  store(tokens: OAuthTokens & { expiresIn?: number; tokenEndpoint?: string; clientId?: string }): void {
    this.tokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      tokenEndpoint: tokens.tokenEndpoint,
      clientId: tokens.clientId,
    };
    this.save();
  }

  /** True when the stored access token is still valid (with 60s buffer). */
  isValid(): boolean {
    if (!this.tokens?.accessToken) return false;
    if (!this.tokens.expiresAt) return true; // no expiry info — assume valid
    return this.tokens.expiresAt - 60_000 > Date.now();
  }

  /** Return the current access token, refreshing if expired. Returns null if unavailable. */
  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (this.isValid()) return this.tokens.accessToken;
    // Try refresh
    if (this.tokens.refreshToken && this.tokens.tokenEndpoint && this.tokens.clientId) {
      const refreshed = await this.refresh(
        this.tokens.tokenEndpoint,
        this.tokens.clientId,
        this.tokens.refreshToken,
      );
      if (refreshed) return refreshed;
    }
    return null;
  }

  /** Perform a refresh_token grant. Returns new access token or null on failure. */
  async refresh(tokenEndpoint: string, clientId: string, refreshToken: string): Promise<string | null> {
    try {
      const resp = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        console.warn(`[MCP OAuth] Token refresh failed for ${this.serverName}: HTTP ${resp.status}`);
        return null;
      }
      const data = await resp.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      this.tokens = {
        ...this.tokens!,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? this.tokens!.refreshToken,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
      this.save();
      return data.access_token;
    } catch (err) {
      console.warn(`[MCP OAuth] Token refresh error for ${this.serverName}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Build Authorization header value, refreshing if needed. */
  async buildAuthHeader(): Promise<string | null> {
    const token = await this.getAccessToken();
    if (!token) return null;
    return `Bearer ${token}`;
  }

  /** Clear stored tokens (e.g. on logout). */
  clear(): void {
    this.tokens = null;
    try { fs.unlinkSync(this.tokenPath); } catch { /* */ }
  }
}

/** Get or create a token manager for a named MCP server. */
const _managers = new Map<string, OAuthTokenManager>();
export function getMcpTokenManager(serverName: string): OAuthTokenManager {
  let m = _managers.get(serverName);
  if (!m) {
    m = new OAuthTokenManager(serverName);
    _managers.set(serverName, m);
  }
  return m;
}
