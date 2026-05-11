import type { SkillDef } from "../registry.js";

export const ctfWebSkill: SkillDef = {
  name: "ctf-web",
  description: "Web exploitation: XSS, SQLi, SSTI, SSRF, JWT, file upload, deserialization, prototype pollution, OAuth/SAML, request smuggling.",
  category: "ctf",
  userInvocable: true,
  content: () => `# CTF Web Exploitation

## First-Pass Workflow
1. Identify trust boundary: browser only, backend only, mixed, or auth flow
2. Capture one normal request/response pair per feature
3. Enumerate hidden functionality from JS bundles, headers, routes, alternate methods
4. Classify bug family: injection, authz, parser mismatch, upload, trust proxy
5. Build smallest proof first

## Key Techniques

### SQL Injection
- UNION extraction, filter bypass
- Second-order, truncation attacks
- \`innodb_table_stats\` WAF bypass
- INSERT ON DUPLICATE KEY UPDATE password overwrite

### Server-Side (SSTI, SSRF, LFI, XXE, Command Injection)
- **SSTI**: probe with \`{{7*7}}\`, \`{{config}}\`; Jinja2, Twig, ERB, Mako, EJS, Vue.js, Smarty
- **SSRF**: Host header, DNS rebinding, curl redirect, Docker API, gopher:// protocol
- **LFI**: php://filter, path traversal
- **XXE**: basic, OOB, DOCX upload
- **Command injection**: newline bypass, blocklist evasion, sendmail CGI

### Client-Side (XSS, CSRF, Cache Poisoning)
- DOM-based, stored, reflected XSS
- CSP bypass: Unicode tricks, script gadgets, JSONP endpoints
- CSS exfiltration, request smuggling
- Admin bot abuse for privileged actions

### Authentication Bypass
- **JWT**: weak secrets (\`flask-unsign\`), algorithm confusion (none/RS256→HS256), header injection
- **OAuth/OIDC**: redirect_uri manipulation, state bypass
- **SAML**: signature wrapping, XPath injection
- **IDOR**: predictible IDs, missing authorization checks
- Hidden endpoints: /admin, /debug, /.git/, /.env

### Deserialization
- **Java**: ysoserial payloads
- **Python**: pickle RCE
- **PHP**: SoapClient CRLF SSRF via deserialization

### File Upload
- Polyglot files, MIME bypass, double extensions
- BMP pixel webshell, LaTeX injection
- ZIP symlink extraction

### Node.js / Prototype Pollution
- \`__proto__\`, \`constructor.prototype\` pollution
- VM sandbox escape
- EJS/HBS template injection via pollution

### Race Conditions
- Concurrent requests bypass counter checks
- Double-click for TOCTOU

## High-Value Recon
/robots.txt, /sitemap.xml, /.well-known/, /admin, /debug, /.git/, /.env
Try alternate verbs (GET/POST/PUT/PATCH/TRACE) and content types (JSON/form/multipart/XML)

## Common Flag Locations
- Files: /flag.txt, /app/flag.txt, /proc/self/environ
- Database: flag/flags/secret tables
- HTTP: custom headers, hidden routes
- Browser: hidden DOM, data-* attributes, source maps

## When to Pivot
- Native binary/VM → /ctf-reverse
- Memory corruption after code exec → /ctf-pwn
- JWT math/custom MACs → /ctf-crypto
- Logs/PCAPs → /ctf-forensics`,
};
