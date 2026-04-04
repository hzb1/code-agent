# Code Agent (CLI v0.1)

A local CLI agent that can read project files through tool calling.

## What this version does

- Accepts a natural-language CLI question
- Calls OpenAI-compatible `chat/completions` endpoints
- Exposes one tool: `read_file`
- Lets the model decide when to call the tool
- Returns the final answer in terminal

## What this version does not do

- UI
- File writing
- Shell command execution
- Multi-model routing
- Advanced planning workflows

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Use the new provider config instead (example in `.env.example`):

```env
LLM_PROVIDER=qwen
LLM_API_KEY=your_api_key
LLM_MODEL=qwen3-coder-plus
```

Supported providers out of the box:

- `deepseek`
- `zhipu`
- `qwen`
- `bytedance`

3. Build:

```bash
npm run build
```

4. Run:

```bash
npm run start -- "解释 package.json"
```

Or directly in development:

```bash
npm run dev -- "这个项目是做什么的"
```
