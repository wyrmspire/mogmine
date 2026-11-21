# MogMine Development Mode and Backend Boundary

**Owner decision:** 2026-11-20  
**Status:** Active working rule

## The short version

Supabase is **not a prerequisite for ordinary MogMine product development**. Continue building and testing the user experience with fixtures and local sample data. Do not pause UI, chart, workflow, challenge, account-display, or review work merely because a Supabase project is paused, shared, unconfigured, or unavailable.

MogMine and ShowMob may use the same Supabase project. They are new applications, and separate tables, migrations, storage paths, and functions are sufficient isolation for the present stage. Do not create infrastructure work solely to give each app its own Supabase project.

## What we learned

The team over-coupled frontend progress to backend availability. That produced avoidable discussion about paused projects, project ownership, and database separation even though the work in front of us did not require persistence.

The correct question is not “Is Supabase ready?” It is:

> Does the feature being implemented require durable shared state?

If the answer is no, use fixtures or local state and keep moving.

## Work that does not require Supabase

These areas should be developed and verified without waiting for a database:

- Mobile and desktop visual design
- Trade review navigation
- Chart layout, zoom, timeframe switching, and overlays
- Manual trade-entry interaction and validation
- Position-box rendering and chart annotations
- Notes and review UI using temporary/local state
- Challenge screens and evaluator logic against fixtures
- Running P&L, account, and drawdown presentation using sample records
- Playbook, statistics, mood, and assistant-interface prototypes
- Accessibility, responsive behavior, loading states, and error states
- Pure calculation and transformation functions
- Golden fixtures, component tests, and screenshot tests

Mocked behavior must remain honest. Label sample data where a user could mistake it for live or saved data, and do not claim persistence when none exists.

## Work that does require Supabase

Reconnect or configure Supabase when the task specifically needs one of these:

- Trades or notes surviving refresh, sign-out, or device changes
- Real user accounts, authentication, or row-level security
- Shared data across devices or users
- The permanent candle archive and its coverage/jobs tables
- Server-side account history, challenge progress, or running totals
- Storage for uploaded/generated files
- Production verification of migrations, policies, scheduled jobs, or database APIs

A feature needing Supabase does not imply that all other work must stop.

## Shared-project rule

MogMine and ShowMob are allowed to share one Supabase project at this stage.

Keep them separated by:

- Distinct, clearly named tables and migration files
- App-specific storage buckets or path prefixes
- App-specific Edge Function names and secrets
- Explicit RLS policies and user ownership on persistent records
- Separate Vercel environment-variable configuration
- A quick smoke test of both apps after any shared database migration

Shared-project risks are understood: common quotas, authentication configuration, and blast radius. Those tradeoffs are acceptable for now and do not justify blocking development.

## Agent decision procedure

Before doing any Supabase work:

1. Identify the exact feature being built.
2. State which durable/shared behavior requires a database.
3. If none does, use fixtures/local state and continue.
4. If persistence is required, inspect the current shared project before creating or repointing infrastructure.
5. Make the smallest backend change that unlocks the feature.
6. Verify the affected MogMine flow and smoke-test ShowMob after shared-project migrations.

Do not reopen the “one project versus two projects” question unless a concrete collision, quota problem, security boundary, or owner requirement appears.

## Current development posture

The default posture is **frontend-first with fixtures**. Prioritize making trade entry, chart review, navigation, challenges, account/P&L views, and the overall product experience coherent. Supabase integration is a scoped feature dependency, not the gate for the whole project.

The candle archive remains valuable because Yahoo intraday history expires. Treat it as a discrete backend workstream. Its urgency does not make Supabase a dependency for unrelated interface work.

## Handoff checklist

When handing MogMine to another agent, include:

- Whether the active task truly requires persistence
- Which fixture or local-data path is currently used
- Any backend calls intentionally disabled or deferred
- The exact trigger that should cause Supabase work to resume
- If the shared project changed, which tables/policies/functions changed and whether both apps were smoke-tested
