# Task-card Conversation Examples

This directory stores optional role-specific conversation examples for task cards.

Current naming convention:

```text
{taskCardId}.dominant.md
{taskCardId}.collaborative.md
```

Example:

```text
morning_exercise_challenge.dominant.md
morning_exercise_challenge.collaborative.md
```

To activate these examples, add an `examples` block to the target entry in
`prompts/realtime/task-cards/manifest.json`.

```json
"examples": {
  "dominant": {
    "file": "examples/morning_exercise_challenge.dominant.md",
    "marker": "# CONVERSATION EXAMPLE: Dominant"
  },
  "collaborative": {
    "file": "examples/morning_exercise_challenge.collaborative.md",
    "marker": "# CONVERSATION EXAMPLE: Collaborative"
  }
}
```

If a task-card entry has no `examples` block, the prompt loader skips conversation
examples and uses only:

```text
base.md
roles/{role}.md
task-cards/{taskCardId}.md
```
