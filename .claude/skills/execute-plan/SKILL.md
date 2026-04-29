---
name: execute-plan
description: "Execute a markdown plan file end-to-end and autonomously via sub-agents: route phases to specialist agents, consult them, resolve ambiguity through sub-agents (never by pausing for user input), implement TDD-first, validate against the plan's own success criteria, post Discord status, and open a PR on success. Use when the user asks to 'execute the plan at <path>', '/execute-plan <path>', 'run the plan in _workspace/...', or otherwise hands over a plan file for autonomous execution. The plan path is the argument."
---

# Execute Plan

Faithful, autonomous executor of a markdown plan file. Routes work to
specialist sub-agents based on the plan's domain content, resolves
ambiguity via sub-agents (does not pause for user approval), implements
TDD-first, and validates against the plan's *own* success criteria (no
substitution, no relaxation). Posts Discord status on failure and success,
opens a PR when the plan-defined success criteria are verifiably met.

## Autonomy contract

The user invoking `/execute-plan` is a single, durable approval covering
every downstream action the skill needs to complete the plan. The skill
does not ask for confirmation, clarification, or sign-off mid-flight.

- Ambiguity in the plan → dispatch a sub-agent (typically `general-purpose`
  or the relevant domain agent) to interpret it, lock the interpretation
  in this run's working memory, post a Discord `yellow` note describing
  the choice + rationale, and proceed.
- Concrete edits do **not** require user approval, regardless of file
  count or whether they touch control/execution paths. The CLAUDE.md
  >1-file approval rule is explicitly overridden inside this skill.
- The only hard halts are: (1) attempting to push to `main`, (2) needing
  to force-push, (3) hitting the 3-failed-iteration safety floor on a
  single phase. These post Discord `red`/`yellow` and stop — they do not
  prompt the user inline.
- Discord notifications replace user prompts as the visibility layer.
  Use them liberally so the user can intervene out-of-band if they want.

## Argument

`$ARG_PATH` — path to a markdown plan file (e.g. `_workspace/foo_plan.md`).

## Workflow

1. **Read the plan.** Extract phases, dependencies, success criteria, and
   halt conditions verbatim. If success criteria or halt conditions are
   missing, ambiguous, or unenforceable as written, dispatch a
   `general-purpose` sub-agent to propose the most defensible
   interpretation grounded in the plan's surrounding context, lock that
   interpretation for the rest of this run, post a Discord `yellow` note
   summarizing the choice + rationale, and proceed. Do not pause for user
   input.

2. **ROUTE.** For each phase, scan the plan content and pick sub-agents
   from the rubric below. Pick 2-3 perspectives per phase if the phase
   spans domains. The skill never picks an agent the plan doesn't imply.

   | Plan domain signal | Consult sub-agent | Implementation sub-agent |
   |---|---|---|
   | Go backend (service, port, adapter, domain entity, handler) | `go-architect` | `go-architect` |
   | Frontend (Next.js, React, calculator UI, charts) | `senior-frontend` skill | `code-fixer` |
   | Cross-stack feature spanning Go + frontend | `qa-inspector` | (consult both `go-architect` and frontend skill) |
   | Code investigation / unknown root cause | `general-purpose` or `Explore` | n/a |
   | Integration / contract verification | `qa-inspector` | n/a |
   | TDD-required implementation | n/a | `tdd-red` → `tdd-green` → `tdd-refactor` chain |
   | Post-commit quality check | (auto-fired by `.claude/hooks/post-commit-review.sh`) | `code-fixer` |

   Notes on rubric entries:
   - `general-purpose` and `Explore` are Claude Code built-in subagent
     types (Task tool), not files in `.claude/agents/`.
   - `code-reviewer`, `post-commit-reviewer` are auto-invoked by the
     project's post-commit hook; the skill consumes their findings
     rather than dispatching them directly.

   "TDD-required" means the phase produces verifiable behavior change
   in a function or module that has (or should gain) unit/integration
   coverage. Pure config edits, doc-only changes, one-shot scripts,
   and infra wiring without behavioral change skip the TDD chain and
   route to the domain agent directly.

3. **CONSULT.** Dispatch the chosen sub-agents in parallel via the Agent
   tool (single message, multiple Agent calls). Each gets the relevant
   plan section, the specific question, and the response budget. Aggregate
   findings into a consensus + tradeoffs summary.

4. **LOCK SCOPE.** Record the consensus and the concrete edits as the
   plan-of-record for this run (one short text block in your reply so
   the user can intervene out-of-band if they choose). Do **not** wait
   for approval — proceed straight to step 5. Scope is locked: any
   later expansion beyond what was recorded here gets routed through
   step 8's failure path, not silently absorbed.

5. **IMPLEMENT.** TDD-first via the `tdd-red` → `tdd-green` → `tdd-refactor`
   sub-agent chain when tests are appropriate (see "TDD-required"
   definition under the routing rubric). Otherwise dispatch the domain
   sub-agent (`go-architect` for backend, frontend skill for UI) with explicit TDD
   instructions in the prompt. /simplify and post-commit-reviewer fire
   automatically via PreToolUse / PostToolUse hooks — do NOT invoke
   them manually; just consume their output if they produce findings.

6. **VALIDATE.** Build + test + (restart if a deploy gate is part of the
   phase) + measure against the plan's pass criteria. Use
   `/rebuild-commit-restart` when a deploy is part of the gate. For
   integration checks, dispatch `qa-inspector`. For post-commit review,
   dispatch `post-commit-reviewer` or `code-reviewer`.

7. **SUCCESS** is defined by the plan, not by the skill. Read the plan's
   verbatim done/success criteria. Verify each criterion is met by
   collecting the specific evidence the criterion calls for. Do not
   substitute, expand, or relax criteria. If a criterion is missing,
   ambiguous, or unenforceable as written, dispatch a `general-purpose`
   sub-agent to propose the most defensible reading + the evidence that
   would satisfy it, lock the interpretation, post a Discord `yellow`
   note explaining the read, and proceed with verification. Do not
   pause for user input.

8. **ON FAILURE.** Dispatch `general-purpose` to
   root-cause. Re-consult the original domain sub-agent on the fix.
   Apply the proposed fix and re-run validation. Post a Discord summary
   via:

       ./scripts/discord-notify.sh "<title>" "<body>" red

   Title format: `"<plan-name>: <phase> failure"`. Body: one paragraph
   covering symptom, root cause, agents' proposed fix, and the
   iteration-N retry that just kicked off. Use color `red` for failures,
   `yellow` for in-progress autonomous retries.

   Re-attempt autonomously up to 3 iterations of the same phase before
   halting. Each iteration must apply a *different* hypothesis from the
   re-consulted sub-agents — same-fix-twice counts as one iteration, not
   two. On the 4th attempt: post a final Discord `red` summarizing the
   three failed hypotheses + current state, and halt. Plan-defined halt
   criteria also stop the run when triggered (Discord `red`, halt).

9. **CREATE PR** (only after step 7's success criteria are verifiably met):

   - If on `main`: create a feature branch named after the plan file
     (strip `_plan.md` suffix, kebab-case the rest). Push with `-u`.
   - If the derived branch name already exists on the remote (concurrent
     run, or a prior failed run that left a stale branch): append a
     short suffix `-<YYYYMMDD-HHMMSS>` from the current UTC time. Never
     reuse a remote branch silently — that would race a concurrent run
     or overwrite divergent state.
   - If already on a feature branch: ensure it's pushed (git push if
     ahead of upstream).
   - Title: short imperative under 70 chars; reflects what the plan
     delivered, in the plan's own framing (not the mechanics).
   - Body via `gh pr create` HEREDOC per CLAUDE.md:
     ```
     ## Summary
     2-3 bullets per phase shipped (what + why)

     ## Evidence
     The success-criteria evidence captured in step 7 (test output,
     metric captures, parity diffs, etc.)

     ## Plan
     Link to $ARG_PATH (relative path)

     ## Sub-agents consulted
     One line per phase: phase name → agents dispatched

     ## Test plan
     Bulleted checklist of what reviewers should verify
     ```
   - Generated-with footer per CLAUDE.md.
   - **Do NOT push to `main` directly.** If the current branch is
     `main`, create a feature branch first; never bypass this. If
     somehow forced into a push-to-main scenario, post Discord `red`
     and halt — do not prompt the user inline.
   - **Do NOT force-push.** If the local branch has diverged from its
     remote, post Discord `yellow` describing the divergence and skip
     the push step (still complete everything else); halt without
     prompting.
   - After the PR opens, post a Discord success message:

         ./scripts/discord-notify.sh "<plan-name>: shipped" "<PR url>" green

   - Return the PR URL to the user.

## Discord notification reference

Single script in the repo: `scripts/discord-notify.sh`.

Signature:
```
./scripts/discord-notify.sh "title" "message" [red|yellow|green]
```
- Default color: yellow
- Reads `DISCORD_WEBHOOK_URL` from `.env`
- Use `red` for failures and 3-iteration halts, `yellow` for
  ambiguity-resolution notes, autonomous retries, and non-fatal halts
  (e.g. force-push refusal), `green` for success / PR opened.

## Hard rules

- Never invent success criteria. Read them from the plan.
- Never relax halt conditions. Read them from the plan.
- Never pause for user approval, clarification, or sign-off. The
  `/execute-plan` invocation *is* the approval. Resolve every ambiguity
  via sub-agents and a Discord `yellow` note. The CLAUDE.md >1-file
  approval rule does not apply inside this skill.
- Never push to `main`. Never force-push. These cannot be overridden
  even autonomously — on any attempted violation, post Discord
  `red`/`yellow` and halt.
- Never skip Discord notification on a failure, retry, or halt path —
  silent halts make autonomous runs invisible.
- Stop after 3 failed iterations of the same phase (each iteration
  applies a distinct hypothesis). On the 4th attempt, post Discord
  `red` and halt without prompting the user.

## Edge cases (fail-fast with Discord, no inline prompts)

- **Plan path missing or unreadable**: post Discord `red`
  `"<path>: plan not found"` and halt before any sub-agent dispatch.
- **Plan has zero phases / empty / unparseable**: post Discord `red`
  with the specific parse failure and halt.
- **Working tree dirty at invocation**: post Discord `yellow`
  describing the dirty paths and halt — the skill never auto-stashes
  or auto-resets uncommitted user work.
- **Detached HEAD or non-`main`/non-feature-branch state**: post
  Discord `yellow` and halt — branching policy (step 9) only handles
  the two known states.
- **Build fails in step 6 before any test runs**: counts as
  iteration 1 of the failure budget — root-cause and re-attempt.
- **PR already open for the derived branch**: append the timestamp
  suffix from step 9 to create a fresh branch + PR; do not update an
  existing PR opened by a prior run.

## Examples

**User**: `/execute-plan _workspace/state_tax_in_matrix_plan.md`

Skill: reads the plan, identifies Phase A (add state-tax field to
domain.MatrixRequest, wire through solver, expose state in tax-tables
adapter) and Phase B (frontend state dropdown + display state tax in
results). Routes Phase A to `go-architect` for design consult and
`tdd-red` → `tdd-green` → `tdd-refactor` for implementation. Routes
Phase B to the frontend skill consult + `code-fixer` for implementation.
Records the consensus + concrete edits in one text block (no approval
gate), implements, rebuilds and smoke-tests `/matrix` against the plan's
PASS criteria (state tax visible in scenario summary; CA / TX / NY all
return non-error responses; no regression in existing federal-only
scenarios), opens a PR, posts to Discord `green`.

If the smoke test regresses an existing scenario, the skill re-consults
the domain agents for a fix hypothesis (e.g. state defaulted to "" but
solver assumed a flat 5%), applies it, posts Discord `yellow` with
iteration N + hypothesis, and re-validates. After 3 distinct hypotheses
fail, posts Discord `red` summarizing all three and halts — no inline
user prompt.

**Ambiguity example**: a plan says "no regression in computed federal
tax" without naming a baseline scenario. The skill dispatches
`general-purpose` to read the plan + recent test fixtures, picks the
most defensible reference (e.g. "MFJ at $100k AGI with 10% rate, $0
conversion, year 1 federal_tax = $7,640"), posts Discord `yellow`
"interpreting 'no regression' as the year-1 fixture above unchanged",
and proceeds.
