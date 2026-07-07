---
name: plan-review-design
description: Interrogate a plan or design doc branch-by-branch until every open decision is resolved. Use when the user shares a plan, spec, or design and asks for feedback, review, or wants it stress-tested — or explicitly invokes /plan-review-design. Explores the codebase to answer what it can before asking the user, and proposes a recommended answer for every question it does ask.
---

# Plan Review Design Interview

Turn a plan review into a relentless, structured interview: walk the plan's
decision tree branch by branch, resolve dependencies between decisions in
order, and don't ask the user anything the codebase can already answer.

## Process

1. **Build the design tree.** Decompose the plan into its individual
   decisions (open questions, ambiguous choices, unstated assumptions).
   Identify which decisions depend on others — a choice upstream can change
   or obsolete choices downstream.

2. **Order by dependency, not by document order.** Resolve foundational
   decisions before the decisions that hang off them. Don't surface a
   downstream question until its upstream dependency is locked in.

3. **Explore before asking.** For each question, check whether it's already
   answered by the existing codebase, specs, or conventions (read the
   relevant files, grep for prior art, check how similar things were done
   elsewhere in the project). Only take a question to the user if the
   codebase is silent or ambiguous on it. Say what you found when you found
   something, rather than asking the user to repeat it.

4. **Ask one resolved-dependency question at a time** (or a small batch of
   genuinely independent siblings). For each question, give your
   recommended answer and the one-line reasoning behind it — a concrete
   proposal, not a neutral list of options — so the user can confirm,
   pick an alternative, or redirect. Use `AskUserQuestion` for this.

5. **Fold the answer back into the tree.** Each answer may resolve,
   reshape, or eliminate other open questions — update the tree before
   continuing. Finish the current branch (its children and grandchildren)
   before moving to a sibling branch.

6. **Stop when every branch is resolved** — no open dependencies remain —
   then summarize the shared understanding reached: the decisions made, the
   reasoning, and anything explicitly deferred.

## Notes

- Depth over breadth: fully resolve one branch before starting the next,
  since sibling branches may depend on choices made in this one.
- Don't ask about anything a `Read`, `Grep`, or `Glob` pass already settles.
- Prefer a concrete recommendation over "it depends" — the user is looking
  to confirm or redirect a stance, not to design from a blank page.
- If the plan itself lives in the repo (a design doc, a spec file), treat
  it as the object under interview and update it once the interview
  resolves a branch, rather than only holding the resolution in chat.
