import { registerTools, allTools } from "@/server/copilot/tool-registry";
import { READ_TOOLS } from "@/server/copilot/read-tools";
import { ACTION_TOOLS } from "@/server/copilot/action-tools";
import { EXTENDED_TOOLS } from "@/server/copilot/extended-tools";

/**
 * The complete set of operations the model can reach. Importing this module is
 * what populates the registry; anything not listed here cannot be called, and
 * there is deliberately no generic query or SQL tool.
 */
if (allTools().length === 0) {
  registerTools([...READ_TOOLS, ...ACTION_TOOLS, ...EXTENDED_TOOLS]);
}

export { allTools };
