/**
 * 最小文本 diff 预览。
 *
 * 说明：
 * - v0.3.0 不引入第三方 diff 依赖，先提供可读的“变更窗口”；
 * - 该预览用于权限确认，不用于精确补丁应用；
 * - 目标是让用户快速看出“将改哪一段、改了什么方向”。
 */
export type TextDiffPreview = {
  changed: boolean;
  summary: string;
  lines: string[];
};

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/);
}

/**
 * 计算首尾一致区间，提取最小变更窗口。
 */
function computeChangeWindow(before: string[], after: string): {
  start: number;
  beforeEnd: number;
  afterEnd: number;
} {
  const afterLines = splitLines(after);
  let start = 0;
  while (
    start < before.length &&
    start < afterLines.length &&
    before[start] === afterLines[start]
  ) {
    start += 1;
  }

  let beforeEnd = before.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    before[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return { start, beforeEnd, afterEnd };
}

export function createTextDiffPreview(options: {
  beforeContent: string;
  afterContent: string;
  maxPreviewLines?: number;
}): TextDiffPreview {
  const maxPreviewLines = options.maxPreviewLines ?? 24;
  if (options.beforeContent === options.afterContent) {
    return {
      changed: false,
      summary: "文件内容无变化。",
      lines: ["(内容一致，无需写入)"]
    };
  }

  const beforeLines = splitLines(options.beforeContent);
  const afterLines = splitLines(options.afterContent);
  const { start, beforeEnd, afterEnd } = computeChangeWindow(beforeLines, options.afterContent);
  const removedCount = Math.max(0, beforeEnd - start + 1);
  const addedCount = Math.max(0, afterEnd - start + 1);

  const lines: string[] = [
    `@@ 从第 ${start + 1} 行开始 @@`,
    `- 删除行数: ${removedCount}`,
    `+ 新增行数: ${addedCount}`
  ];

  const removedPreview = beforeLines.slice(start, beforeEnd + 1);
  const addedPreview = afterLines.slice(start, afterEnd + 1);
  const previewBudget = Math.max(4, maxPreviewLines - lines.length - 2);
  const removedBudget = Math.max(2, Math.floor(previewBudget / 2));
  const addedBudget = Math.max(2, previewBudget - removedBudget);

  lines.push("--- before");
  for (const line of removedPreview.slice(0, removedBudget)) {
    lines.push(`- ${line}`);
  }
  if (removedPreview.length > removedBudget) {
    lines.push(`- ...(省略 ${removedPreview.length - removedBudget} 行)`);
  }

  lines.push("+++ after");
  for (const line of addedPreview.slice(0, addedBudget)) {
    lines.push(`+ ${line}`);
  }
  if (addedPreview.length > addedBudget) {
    lines.push(`+ ...(省略 ${addedPreview.length - addedBudget} 行)`);
  }

  return {
    changed: true,
    summary: `检测到文本变更：删除 ${removedCount} 行，新增 ${addedCount} 行。`,
    lines
  };
}
