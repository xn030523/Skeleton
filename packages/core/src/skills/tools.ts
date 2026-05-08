import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "../types.js";
import type { SkillRegistry, SkillDef } from "./registry.js";

/** skill_view tool — Tier 2 progressive disclosure: load full skill instructions on demand */
export function skillViewTool(registry: SkillRegistry): ToolDef {
  return {
    name: "skill_view",
    description:
      "View full instructions for a specific skill (Tier 2 progressive disclosure). " +
      "Use after identifying a relevant skill from the catalog to get detailed workflow and techniques.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill name to view full instructions for.",
        },
      },
      required: ["name"],
    },
    execute: async (args) => {
      const name = String(args.name ?? "");
      if (!name) return "Error: name is required";
      const skill = registry.get(name);
      if (!skill) return `Error: skill '${name}' not found`;
      return skill.content();
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
      "Manage skills dynamically. Actions: " +
      "'create' — create a new reusable skill document; " +
      "'edit' — replace entire skill content; " +
      "'patch' — update description/category only; " +
      "'delete' — remove a skill; " +
      "'list' — list all skills; " +
      "'write_file' — add a resource file to a skill; " +
      "'remove_file' — delete a resource file from a skill.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "edit", "patch", "delete", "list", "write_file", "remove_file"],
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
        file_name: {
          type: "string",
          description: "Resource file name (for write_file/remove_file).",
        },
        file_content: {
          type: "string",
          description: "Resource file content (for write_file).",
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

          // Capture content value immediately — not by reference to args
          const capturedContent = String(args.content);
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

          registry.unregister(name);
          registry.deleteFromDisk(name);
          return `Skill '${name}' deleted.`;
        }

        case "write_file": {
          if (!name) return "Error: name is required";
          if (!args.file_name) return "Error: file_name is required";
          if (args.file_content === undefined || args.file_content === null) return "Error: file_content is required";
          const existing = registry.get(name);
          if (!existing?.agentCreated) return `Error: custom skill '${name}' not found`;

          const skillDir = path.join(
            registry.getSkillDir(),
            name.replace(/[^a-z0-9_-]/gi, "_"),
          );
          fs.mkdirSync(skillDir, { recursive: true });
          fs.writeFileSync(
            path.join(skillDir, String(args.file_name)),
            String(args.file_content),
            "utf-8",
          );
          return `File '${args.file_name}' added to skill '${name}'.`;
        }

        case "remove_file": {
          if (!name) return "Error: name is required";
          if (!args.file_name) return "Error: file_name is required";
          const existing = registry.get(name);
          if (!existing?.agentCreated) return `Error: custom skill '${name}' not found`;

          const skillDir = path.join(
            registry.getSkillDir(),
            name.replace(/[^a-z0-9_-]/gi, "_"),
          );
          const filePath = path.join(skillDir, String(args.file_name));
          if (!fs.existsSync(filePath)) return `Error: file '${args.file_name}' not found`;
          fs.unlinkSync(filePath);
          return `File '${args.file_name}' removed from skill '${name}'.`;
        }

        default:
          return `Error: unknown action '${action}'`;
      }
    },
  };
}
