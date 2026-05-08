import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const PERSONALITIES_DIR = path.join(SKELETON_DIR, "personalities");
const DEFAULT_FILE = "default.md";

export class PersonalityStore {
  private activeName: string;
  private cache: Map<string, string> = new Map();

  constructor() {
    this.activeName = DEFAULT_FILE;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(PERSONALITIES_DIR)) {
      fs.mkdirSync(PERSONALITIES_DIR, { recursive: true });
    }
  }

  private resolvePath(name: string): string {
    const safeName = name.endsWith(".md") ? name : `${name}.md`;
    return path.join(PERSONALITIES_DIR, safeName);
  }

  list(): string[] {
    this.ensureDir();
    try {
      return fs
        .readdirSync(PERSONALITIES_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""));
    } catch {
      return [];
    }
  }

  getActive(): string | null {
    if (this.cache.has(this.activeName)) {
      return this.cache.get(this.activeName)!;
    }
    const filePath = this.resolvePath(this.activeName);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8").trim();
        if (content) {
          this.cache.set(this.activeName, content);
          return content;
        }
      }
    } catch {
      // file not readable
    }
    return null;
  }

  setActive(name: string): boolean {
    const filePath = this.resolvePath(name);
    if (!fs.existsSync(filePath)) return false;
    this.activeName = name.endsWith(".md") ? name : `${name}.md`;
    this.cache.delete(this.activeName);
    return true;
  }

  get(name: string): string | null {
    const key = name.endsWith(".md") ? name : `${name}.md`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const filePath = this.resolvePath(name);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8").trim();
        if (content) {
          this.cache.set(key, content);
          return content;
        }
      }
    } catch {
      // not readable
    }
    return null;
  }

  set(name: string, content: string): void {
    this.ensureDir();
    const key = name.endsWith(".md") ? name : `${name}.md`;
    const filePath = this.resolvePath(name);
    fs.writeFileSync(filePath, content, "utf-8");
    this.cache.set(key, content.trim());
  }

  delete(name: string): boolean {
    const filePath = this.resolvePath(name);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        const key = name.endsWith(".md") ? name : `${name}.md`;
        this.cache.delete(key);
        if (this.activeName === key) {
          this.activeName = DEFAULT_FILE;
          this.cache.delete(DEFAULT_FILE);
        }
        return true;
      }
    } catch {
      // delete failed
    }
    return false;
  }

  getActiveName(): string {
    return this.activeName.replace(/\.md$/, "");
  }

  reset(): void {
    this.activeName = DEFAULT_FILE;
    this.cache.clear();
  }
}
