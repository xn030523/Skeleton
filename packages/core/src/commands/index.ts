export { processCommandAsync } from "./processor.js";
export type { CommandAction, CommandContext, OutputAdapter } from "./processor.js";
export {
  COMMAND_REGISTRY,
  resolveCommand,
  listAllCommandNames,
  commandsByCategory,
  commandHelpLine,
  getSubcommands,
} from "./registry.js";
export type { CommandDef, CommandCategory } from "./registry.js";
