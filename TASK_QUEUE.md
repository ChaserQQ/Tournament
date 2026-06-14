# Task Queue

This document coordinates the split chats for MINI4WD Tournament Maker.
Each chat should read `AGENT_MEMORY.md`, `UI_REDESIGN_BRIEF.md`, and this file before acting.

## Global Rules
- 2026-06-23 update: split-chat role structure is stopped by the latest user instruction.
- Treat this file as the v224 implementation checklist only until the user re-enables multi-chat coordination.
- Master chat decides direction and writes instructions.
- Only the implementation chat edits app code.
- Design, verification, and Firebase chats do not edit app code unless the user explicitly changes that rule.
- Each role writes its result to the assigned report file so the master chat can inspect it without pasted chat logs.
- Keep reports short and in Korean.
- `.codex-remote-attachments/` must not be committed.
- Public app changes require build metadata and asset query updates.
- After implementation changes: validate, make a single snapshot commit, force-push with lease, watch GitHub Pages, and verify public assets.

## Shared Report Files
- Design chat writes to `DESIGN_OUTPUT.md`.
- Implementation chat writes to `IMPLEMENTATION_REPORT.md`.
- Verification/deployment chat writes to `QA_REPORT.md`.
- Firebase/DB chat writes to `FIREBASE_REPORT.md`.
- Master chat reads these files and decides the next instruction.
- Do not store secrets, auth codes, raw Firebase exports, or private user data in report files.

## Chat Roles

### Master Chat
- Decide direction and priority.
- Review outputs from other chats.
- Write the next instruction for each role.
- Stop or roll back work if the direction is rejected.
- Default: no code edits.

### Design Chat
- Read shared documents.
- Produce structure, layout, copy, and component guidance.
- Do not edit code.
- Do not propose CSS-only patch layers.
- Output must be implementable by screen and component.
- Write the final result to `DESIGN_OUTPUT.md`.

### Implementation Chat
- Read shared documents and inspect the current repository state.
- Code changes happen here only.
- Start from the accepted v222 baseline and use v224 for the next public app change.
- Work in controlled phases:
  1. Common UI foundation
  2. Operator screen
  3. Player DB
  4. Admin screen
  5. LIVE/viewer screen
  6. Login, permission, waiting, error states
  7. Print, result, auxiliary screens
  8. CSS cleanup and dead-selector removal
- Preserve tournament logic unless explicitly instructed otherwise.
- Run required validation and deployment checks after changes.
- Write the final result to `IMPLEMENTATION_REPORT.md`.

### Verification/Deployment Chat
- Read shared documents and inspect repository state.
- Default: no code edits.
- Check QA scripts, mobile/desktop overflow, public assets, and Pages deployment.
- Report broken screens and exact reproduction details.
- If a fix is needed, write a concise implementation instruction instead of changing code.
- Write the final result to `QA_REPORT.md`.

### Firebase/DB Chat
- Read shared documents.
- Focus on Firebase RTDB, player DB data, permissions, import/export, and data mismatch.
- UI code edits are not allowed.
- Direct Firebase modification requires explicit user approval.
- Write the final result to `FIREBASE_REPORT.md`.

## Current Priority
1. v255 complete: removed stale operator queue/controller CSS-only selectors.
2. Public v255 index/build/css assets were verified after GitHub Pages deployment.
3. Await the next user instruction.

## First Implementation Instruction
Use this when starting implementation:

```text
AGENT_MEMORY.md, UI_REDESIGN_BRIEF.md, TASK_QUEUE.md 읽고 구현 역할만 수행해.
현재 기준은 v222이고, 폐기된 v223 방향은 이어가지 마.
v224 작업으로 공통 UI foundation + 운영 화면 1차 재구성부터 시작해.
CSS 덧씌우기보다 DOM 구조, 공통 컴포넌트, 중복 문구 제거를 우선해.
변경 후 verify, QA, 단일 스냅샷 커밋, force push, Pages/public asset 확인까지 진행해.
결과는 IMPLEMENTATION_REPORT.md에 짧게 기록해.
보고는 한국어로 짧게.
```

## First Design Instruction
Use this when asking for design refinement:

```text
AGENT_MEMORY.md, UI_REDESIGN_BRIEF.md, TASK_QUEUE.md 읽고 디자인 역할만 수행해.
코드 수정 금지.
전체 UI 개편 기준에서 운영 화면을 먼저 구조화해.
결과는 PC/모바일 레이아웃, 주요 컴포넌트, 제거할 문구, 구현 순서만 짧게 정리해.
최종 결과는 DESIGN_OUTPUT.md에 기록해.
```

## First Verification Instruction
Use this after implementation reports a completed version:

```text
AGENT_MEMORY.md, UI_REDESIGN_BRIEF.md, TASK_QUEUE.md 읽고 검증/배포 역할만 수행해.
기본은 코드 수정 금지.
현재 구현 결과의 PC/모바일 overflow, 운영 화면 흐름, 선수 DB 파손 여부, Pages/public asset 상태를 확인해.
문제만 정확히 짧게 보고해.
최종 결과는 QA_REPORT.md에 기록해.
```
