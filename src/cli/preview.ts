import type { PermissionPrompt } from "#src/permissions/types.js";

/**
 * 格式化权限预览文本。
 *
 * 目标：
 * - 让用户在确认前快速看到“做什么 + 影响什么”；
 * - 输出保持简洁，避免确认弹层过重。
 */
export function formatPermissionPreview(prompt: PermissionPrompt): string[] {
  const lines = [`[权限] 工具：${prompt.toolName}`, `[权限] 原因：${prompt.reason}`];

  if (prompt.previewTitle) {
    lines.push(`[权限] 预览：${prompt.previewTitle}`);
  }

  if (prompt.previewLines && prompt.previewLines.length > 0) {
    for (const line of prompt.previewLines) {
      lines.push(`[权限] ${line}`);
    }
  }

  return lines;
}
