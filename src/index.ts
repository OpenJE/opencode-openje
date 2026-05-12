import type { PluginModule } from "@opencode-ai/plugin";
import { OpenJePlugin } from "./opencode/plugin.js";
export { ReProgress } from "./core/ReProgress.js";
export { ReProgressError, formatError, formatSuccess } from "./core/errors.js";
export * from "./db/types.js";
export { OpenJePlugin } from "./opencode/plugin.js";
const pluginModule: PluginModule = { id: "opencode-openje", server: OpenJePlugin };
export default pluginModule;
