import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../types.js";
import type { SkillRegistry, SkillDef } from "./registry.js";

/** skill_view tool — Tier 2 progressive disclosure: load full skill instructions on demand */
export function skillViewTool(registry: SkillRegistry): ToolDef {
  return {
    name: "skill_view",
    description:
      "Load a skill's full content or access its linked files (references, templates, scripts). " +
      "First call returns SKILL.md content plus a 'linked_files' list showing available supporting files. " +
      "To access those, call again with file_path parameter.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name to view.",
        },
        file_path: {
          type: "string",
          description: "Optional: path to a linked file within the skill (e.g. 'references/api.md', 'scripts/run.sh'). Omit to get main SKILL.md content.",
        },
      },
      required: ["name"],
    },
    execute: async (args) => {
      const name = String(args.name ?? "");
      if (!name) return "Error: name is required";
      const skill = registry.get(name);
      if (!skill) return `Error: skill '${name}' not found`;

      // Track usage
      try {
        const { bumpSkillUsage } = require("./usage.js") as typeof import("./usage.js");
        bumpSkillUsage(name);
      } catch { /* non-critical */ }

      // If file_path specified, load that specific file
      const filePath = String(args.file_path ?? "");
      if (filePath) {
        if (filePath.includes("..")) return "Error: path traversal not allowed.";
        const content = skill.loadResource?.(filePath);
        if (!content) return `Error: file '${filePath}' not found in skill '${name}'.`;
        return JSON.stringify({ success: true, name, file: filePath, content });
      }

      // Main content + linked files listing
      const content = skill.content();
      const linkedFiles = skill.listResources?.() ?? [];
      const result: Record<string, unknown> = {
        success: true,
        name,
        description: skill.description,
        category: skill.category,
        content,
        skill_dir: skill.skillDir ?? null,
      };
      if (linkedFiles.length > 0) {
        result.linked_files = linkedFiles;
        result.usage_hint = "To view linked files, call skill_view(name, file_path) where file_path is e.g. 'references/api.md'";
      }
      return JSON.stringify(result);
    },
  };
}

/** skill_resource tool — Tier 3: load a resource file from a skill */
export function skillResourceTool(registry: SkillRegistry): ToolDef {
  return {
    name: "skill_resource",
    description:
      "Load a resource file from a skill (Tier 3 progressive disclosure). " +
      "Resources are reference files, scripts, or assets stored in the skill's resources/ directory.",
    parameters: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description: "Skill name that owns the resource.",
        },
        file_name: {
          type: "string",
          description: "Resource file name.",
        },
        list_only: {
          type: "boolean",
          description: "If true, only list available resources instead of loading content.",
        },
      },
      required: ["skill_name"],
    },
    execute: async (args) => {
      const skillName = String(args.skill_name ?? "");
      if (!skillName) return "Error: skill_name is required";

      if (args.list_only) {
        const resources = registry.listSkillResources(skillName);
        return resources.length > 0
          ? `Resources for '${skillName}':\n${resources.map((r) => `  - ${r}`).join("\n")}`
          : `No resources found for skill '${skillName}'.`;
      }

      const fileName = String(args.file_name ?? "");
      if (!fileName) {
        const resources = registry.listSkillResources(skillName);
        return resources.length > 0
          ? `Available resources: ${resources.join(", ")}. Specify file_name to load.`
          : `No resources for '${skillName}'.`;
      }

      const content = registry.loadSkillResource(skillName, fileName);
      if (!content) return `Error: resource '${fileName}' not found in skill '${skillName}'`;
      return content;
    },
  };
}

/** skill_manage tool — lets the LLM create, edit, and delete skills at runtime */
export function skillManageTool(registry: SkillRegistry): ToolDef {
  return {
    name: "skill_manage",
    description:
      "Manage skills — your procedural memory for recurring task types. " +
      "Actions: 'create' — create a new skill (SKILL.md + frontmatter); " +
      "'edit' — replace entire skill content; " +
      "'patch' — update description/category/invocable OR do a fuzzy find-and-replace on SKILL.md content (pass old_string + new_string); " +
      "'delete' — remove a skill; " +
      "'rename' — rename a skill; " +
      "'list' — list all skills; " +
      "'pin' — pin a skill (prevents deletion); " +
      "'unpin' — unpin a skill; " +
      "'write_file' — add a supporting file (references/templates/scripts); " +
      "'remove_file' — delete a supporting file.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "edit", "patch", "delete", "rename", "list", "pin", "unpin", "write_file", "remove_file"],
          description: "Action to perform.",
        },
        name: {
          type: "string",
          description: "Skill name (required for all actions except 'list'). Use kebab-case.",
        },
        description: {
          type: "string",
          description: "Short description (for create/patch).",
        },
        category: {
          type: "string",
          description: "Skill category (for create/patch). Default: 'general'.",
        },
        content: {
          type: "string",
          description: "Full skill content/instructions in Markdown (for create/edit).",
        },
        user_invocable: {
          type: "boolean",
          description: "Whether users can invoke this skill by name (for create/patch). Default: false.",
        },
        old_string: {
          type: "string",
          description: "Text to find in SKILL.md (for patch action — fuzzy find-and-replace). Use skill_view first to read current content.",
        },
        new_string: {
          type: "string",
          description: "Replacement text (for patch action — fuzzy find-and-replace).",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (for patch action). Default: false.",
        },
        file_name: {
          type: "string",
          description: "Resource file name (for write_file/remove_file).",
        },
        file_content: {
          type: "string",
          description: "Resource file content (for write_file).",
        },
        new_name: {
          type: "string",
          description: "New skill name (for rename action).",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const action = String(args.action);
      const name = String(args.name ?? "");

      switch (action) {
        case "list": {
          const { builtin, agent } = registry.listBySource();
          const lines: string[] = [];
          if (builtin.length > 0) {
            lines.push("Built-in skills:");
            for (const s of builtin) lines.push(`  - ${s.name}: ${s.description}`);
          }
          if (agent.length > 0) {
            lines.push("Custom skills:");
            for (const s of agent) lines.push(`  - ${s.name}: ${s.description} (custom)`);
          }
          if (lines.length === 0) lines.push("No skills registered.");
          return lines.join("\n");
        }

        case "create": {
          if (!name) return "Error: name is required";
          if (!args.content) return "Error: content is required";
          if (registry.has(name)) return `Error: skill '${name}' already exists. Use 'edit' to modify.`;

          // Security: prompt injection scan
          const contentStr = String(args.content);
          const injectionPatterns = ["ignore previous instructions", "ignore all previous", "you are now", "disregard your", "system prompt:"];
          const lowerContent = contentStr.toLowerCase();
          if (injectionPatterns.some(p => lowerContent.includes(p))) {
            return "Error: skill content contains patterns that may indicate prompt injection. Refusing to create.";
          }

          const capturedContent = contentStr;
          const capturedDesc = String(args.description ?? `Custom skill: ${name}`);
          const capturedCat = String(args.category ?? "general");
          const capturedInvocable = Boolean(args.user_invocable ?? false);

          const skill: SkillDef = {
            name,
            description: capturedDesc,
            category: capturedCat,
            userInvocable: capturedInvocable,
            agentCreated: true,
            content: () => capturedContent,
          };

          registry.register(skill);
          registry.saveToDisk(skill);

          // Track usage
          try {
            const { bumpSkillUsage } = require("./usage.js") as typeof import("./usage.js");
            bumpSkillUsage(name);
          } catch { /* non-critical */ }

          return `Skill '${name}' created and persisted to disk.`;
        }

        case "edit": {
          if (!name) return "Error: name is required";
          if (!args.content) return "Error: content is required";
          const existing = registry.get(name);
          if (!existing) return `Error: skill '${name}' not found`;
          if (!existing.agentCreated) return `Error: cannot edit built-in skill '${name}'`;

          const capturedContent = String(args.content);
          const capturedDesc = String(args.description ?? existing.description);

          const updated: SkillDef = {
            ...existing,
            description: capturedDesc,
            content: () => capturedContent,
          };
          registry.register(updated);
          registry.saveToDisk(updated);
          return `Skill '${name}' updated and saved to disk.`;
        }

        case "patch": {
          if (!name) return "Error: name is required";
          const existing = registry.get(name);
          if (!existing) return `Error: skill '${name}' not found`;
          if (!existing.agentCreated) return `Error: cannot patch built-in skill '${name}'`;

          // Content-level fuzzy patch (Hermes _patch_skill pattern)
          if (args.old_string !== undefined && args.new_string !== undefined) {
            const { fuzzyFindAndReplace } = require("../tools/fuzzy-match.js") as typeof import("../tools/fuzzy-match.js");
            const currentContent = existing.content();
            const res = fuzzyFindAndReplace(
              currentContent,
              String(args.old_string),
              String(args.new_string),
              Boolean(args.replace_all),
            );
            if (res.error) return `Error: patch failed — ${res.error}`;
            if (res.matchCount === 0) return `Error: old_string not found in skill '${name}'. Use skill_view to read the current content first.`;

            const updatedSkill = { ...existing, content: () => res.newContent };
            registry.register(updatedSkill);
            registry.saveToDisk(updatedSkill);
            return `Skill '${name}' content patched (${res.matchCount} replacement(s), strategy=${res.strategy}).`;
          }

          // Metadata-only patch
          registry.update(name, {
            description: args.description ? String(args.description) : undefined,
            category: args.category ? String(args.category) : undefined,
            userInvocable: args.user_invocable !== undefined ? Boolean(args.user_invocable) : undefined,
          });

          const patched = registry.get(name)!;
          registry.saveToDisk(patched);
          return `Skill '${name}' patched and saved.`;
        }

        case "delete": {
          if (!name) return "Error: name is required";
          const existing = registry.get(name);
          if (!existing) return `Error: skill '${name}' not found`;
          if (!existing.agentCreated) return `Error: cannot delete built-in skill '${name}'`;
          if (existing.pinned) return `Error: skill '${name}' is pinned — use skill_manage(action='unpin') first`;

          registry.unregister(name);
          registry.deleteFromDisk(name);
          return `Skill '${name}' deleted.`;
        }

        case "pin": {
          if (!name) return "Error: name is required";
          const ok = registry.pin(name);
          return ok ? `Skill '${name}' pinned — it will not be auto-archived or deleted.` : `Error: skill '${name}' not found`;
        }

        case "unpin": {
          if (!name) return "Error: name is required";
          const ok = registry.unpin(name);
          return ok ? `Skill '${name}' unpinned.` : `Error: skill '${name}' not found`;
        }

        case "write_file": {
          if (!name) return "Error: name is required";
          if (!args.file_name) return "Error: file_name is required (e.g. 'references/api.md', 'scripts/run.sh')";
          if (args.file_content === undefined || args.file_content === null) return "Error: file_content is required";
          const existing = registry.get(name);
          if (!existing?.agentCreated) return `Error: custom skill '${name}' not found`;

          const fileName = String(args.file_name);
          // Security: block path traversal
          if (fileName.includes("..") || fileName.startsWith("/")) {
            return "Error: path traversal not allowed. Use relative paths like 'references/api.md'.";
          }

          const skillDir = existing.skillDir ?? path.join(
            registry.getSkillDir(),
            name.replace(/[^a-z0-9_-]/gi, "_"),
          );
          const targetPath = path.join(skillDir, fileName);
          // Ensure parent directory exists (supports references/foo.md, scripts/bar.sh)
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, String(args.file_content), "utf-8");

          // Track usage
          try {
            const { bumpSkillUsage } = require("./usage.js") as typeof import("./usage.js");
            bumpSkillUsage(name);
          } catch { /* non-critical */ }

          return `File '${fileName}' written to skill '${name}' at ${targetPath}.`;
        }

        case "remove_file": {
          if (!name) return "Error: name is required";
          if (!args.file_name) return "Error: file_name is required";
          const existing = registry.get(name);
          if (!existing?.agentCreated) return `Error: custom skill '${name}' not found`;

          const skillDir = existing.skillDir ?? path.join(
            registry.getSkillDir(),
            name.replace(/[^a-z0-9_-]/gi, "_"),
          );
          const filePath = path.join(skillDir, String(args.file_name));
          if (!fs.existsSync(filePath)) return `Error: file '${args.file_name}' not found`;
          fs.unlinkSync(filePath);
          return `File '${args.file_name}' removed from skill '${name}'.`;
        }

        case "rename": {
          if (!name) return "Error: name (current name) is required";
          const newName = String(args.new_name ?? args.file_name ?? "");
          if (!newName) return "Error: new_name is required";
          const existing = registry.get(name);
          if (!existing) return `Error: skill '${name}' not found`;
          if (!existing.agentCreated) return `Error: cannot rename built-in skill '${name}'`;
          if (registry.has(newName)) return `Error: skill '${newName}' already exists`;

          // Delete old, create new
          const content = existing.content();
          registry.unregister(name);
          registry.deleteFromDisk(name);

          const renamed: SkillDef = {
            ...existing,
            name: newName,
            content: () => content,
          };
          registry.register(renamed);
          registry.saveToDisk(renamed);
          return `Skill renamed: '${name}' → '${newName}'.`;
        }

        default:
          return `Error: unknown action '${action}'`;
      }
    },
  };
}
