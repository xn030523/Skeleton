export {
  registerProvider,
  findProvider,
  listProviders,
  resolveProviderConfig,
  apiModeToProtocol,
} from "./registry.js";

export type { ProviderProfile, ApiMode, AuthMode, ProviderQuirks } from "./registry.js";

// Import profiles to trigger registration on first import
import "./profiles.js";
