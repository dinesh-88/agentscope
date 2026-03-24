# AgentScope Changelog

## v0.2.0 (Release Candidate) - 2026-03-24

### Core Improvements
- Refocused product around debugging clarity instead of raw observability
- Improved run view to answer:
  - What failed
  - Why it failed
  - What to fix

### New Features

#### Insights Panel (Primary UX)
- Moved insights to top of run view
- Added structured output:
  - Cause
  - Recommendation
  - Impact

#### Transition Layer (Between Steps)
- Introduced transition blocks between spans
- Shows:
  - Context changes
  - Token deltas
  - Tool outputs
  - Warnings (e.g. missing validation)

#### Auto-Focus Failure
- Automatically highlights failing span on load
- Scrolls into view
- Improves debugging speed

#### Instruction Context (Initial)
- Displays:
  - System prompt
  - AGENTS.md (if available)
- Lays foundation for instruction-aware debugging

### Insights Engine Updates
- Improved root cause messaging
- Added support for:
  - failure explanation
  - actionable recommendations

### Comparison Improvements
- Enhanced summary clarity
- Better visibility of:
  - latency changes
  - token usage
  - cost differences

### UI / UX Improvements
- 3-column layout:
  - span tree
  - timeline + transitions
  - details panel
- Grouped right panel into:
  - Context
  - Output
  - Signals

### Demo Improvements
- Deterministic demo flow:
  - includes failure scenario
  - includes success scenario
- Optimized for onboarding and product tour

---

## v0.1.0

### Initial Release
- Run + span tracing
- Artifact storage (prompt, response, tools)
- Basic insights engine
- Comparison (v1)
- Demo app

---

## Next (Planned)

### Phase 2
- Instruction diff + drift detection
- Context diff improvements
- Step transition insights

### Phase 3
- CLI integration
- VS Code extension
- PR / CI integration

---

## Direction

AgentScope is evolving from:

Trace viewer

to:

AI agent debugger

Focus:
- clarity over volume
- causality over logs
- actionable insights over raw data
