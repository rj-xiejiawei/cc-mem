export const USAGE_GUIDE = `You have access to cc-mem, a cross-session memory system.

## When to use each tool:

- **add_observation**: After completing significant work (bug fix, feature, architectural decision). Pass raw_context to let LLM extract structured fields automatically.
- **get_context**: When starting a new task or conversation, to recall relevant past work.
- **search**: When you need to find specific past observations by keyword.
- **summarize**: At the end of a session to create a summary of what was accomplished.
- **review_observation**: To confirm or reject pending observations.
- **list_projects**: To see all projects that have stored memories.
- **delete_observation**: To remove incorrect or outdated observations.

## Best practices:
- Record observations with raw_context for automatic extraction
- Use get_context at session start for continuity
- Summarize before ending a session
`
