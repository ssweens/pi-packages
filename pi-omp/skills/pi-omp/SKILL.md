---
name: pi-omp-roles
description: Bundled role prompt pack ported from omp — scout, reviewer, security-reviewer, librarian, and designer. Load the specific role skill when you need its specialized procedure and output contract.
---

# pi-omp roles

Five role skills, ported from oh-my-pi's `prompts/agents/`:

| Role | Skill | When to use |
|------|-------|-------------|
| Scout | `/skill:pi-omp-scout` | Exploratory read-only research of an unfamiliar codebase |
| Reviewer | `/skill:pi-omp-reviewer` | Structured code review with concrete findings |
| Security reviewer | `/skill:pi-omp-security-reviewer` | Read-only security analysis |
| Librarian | `/skill:pi-omp-librarian` | Source-verified API / library research |
| Designer | `/skill:pi-omp-designer` | UI implementation and review |

Load one with `/skill:<name>`, e.g. `/skill:pi-omp-scout` followed by the target description.
