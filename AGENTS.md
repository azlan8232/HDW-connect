<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md

- Patient data lives in browser localStorage via `src/lib/hdw/store.ts` (schema-versioned, merges with blankPatient on load) — local-first prototype; swap store for a backend later without touching documents.
- Documents (`/documents/$id/$type`) render deterministically from the single Patient record; Final status freezes a snapshot so verified documents are never silently overwritten.
- No governance labels (PROTOTYPE etc.) on printed documents; they belong on /about.
