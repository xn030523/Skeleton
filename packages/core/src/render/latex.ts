/**
 * Terminal LaTeX rendering — converts common LaTeX math to Unicode approximations.
 *
 * Not a full LaTeX renderer. Handles:
 *   - Inline math:  $expr$  and  \(expr\)
 *   - Display math: $$expr$$  and  \[expr\]
 *   - Greek letters: \alpha \beta ... \Omega
 *   - Common operators: \sum \int \infty \to \leq \geq \neq \approx
 *   - Sub/superscripts: x^2 → x² ; x_1 → x₁ (single char only)
 *   - Fractions: \frac{a}{b} → a/b
 *   - \sqrt{x} → √x
 */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε", Zeta: "Ζ",
  Eta: "Η", Theta: "Θ", Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ",
  Nu: "Ν", Xi: "Ξ", Pi: "Π", Rho: "Ρ", Sigma: "Σ", Tau: "Τ",
  Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
  varphi: "φ", varepsilon: "ε", vartheta: "ϑ",
};

const OPERATORS: Record<string, string> = {
  sum: "∑", prod: "∏", int: "∫", iint: "∬", iiint: "∭",
  oint: "∮", partial: "∂", nabla: "∇", infty: "∞",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
  Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔",
  leq: "≤", geq: "≥", neq: "≠", approx: "≈", equiv: "≡",
  pm: "±", mp: "∓", times: "×", div: "÷", cdot: "·",
  subset: "⊂", supset: "⊃", subseteq: "⊆", supseteq: "⊇",
  in: "∈", notin: "∉", cup: "∪", cap: "∩",
  emptyset: "∅", exists: "∃", forall: "∀", neg: "¬",
  wedge: "∧", vee: "∨", oplus: "⊕", otimes: "⊗",
  ldots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
  sqrt: "√",
};

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  "n": "ⁿ", "i": "ⁱ",
};

const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "i": "ᵢ", "o": "ₒ", "u": "ᵤ",
  "x": "ₓ", "n": "ₙ",
};

/** Render LaTeX math inside delimiters to Unicode approximation */
export function renderLatexMath(text: string): string {
  // Display math: $$...$$ or \[...\]
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => `\n${renderMath(expr.trim())}\n`);
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => `\n${renderMath(expr.trim())}\n`);
  // Inline math: $...$ or \(...\)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) => renderMath(expr.trim()));
  text = text.replace(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_, expr) => renderMath(expr.trim()));

  return text;
}

function renderMath(expr: string): string {
  let result = expr;

  // Fractions: \frac{a}{b} → (a)/(b) or a/b
  result = result.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, a, b) => `${a}/${b}`);

  // \sqrt{x} → √(x) or √x if single token
  result = result.replace(/\\sqrt\{([^{}]+)\}/g, (_, x) => x.length === 1 ? `√${x}` : `√(${x})`);

  // Commands with \name
  result = result.replace(/\\([a-zA-Z]+)/g, (_, name) => {
    if (GREEK[name]) return GREEK[name];
    if (OPERATORS[name]) return OPERATORS[name];
    return `\\${name}`;
  });

  // Superscripts: ^{abc} or ^x (single char)
  result = result.replace(/\^\{([^{}]+)\}/g, (_, inner) => toScript(inner, SUPERSCRIPT));
  result = result.replace(/\^(\S)/g, (_, ch) => SUPERSCRIPT[ch] ?? `^${ch}`);

  // Subscripts: _{abc} or _x
  result = result.replace(/_\{([^{}]+)\}/g, (_, inner) => toScript(inner, SUBSCRIPT));
  result = result.replace(/_(\S)/g, (_, ch) => SUBSCRIPT[ch] ?? `_${ch}`);

  // Clean up braces
  result = result.replace(/\{/g, "").replace(/\}/g, "");

  return result;
}

function toScript(text: string, map: Record<string, string>): string {
  let out = "";
  let unsupported = false;
  for (const ch of text) {
    if (map[ch]) {
      out += map[ch];
    } else {
      unsupported = true;
      break;
    }
  }
  return unsupported ? `^{${text}}` : out;
}
