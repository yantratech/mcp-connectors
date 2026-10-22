## What changed and why

<!-- Before/after. Link the issue if there is one. -->

## Breaking changes

<!-- Any change to a tool name, parameter, or response shape. Write "None." if none. -->

## Deleted or moved files

<!-- List every one, so reviewers can check that nothing still refers to the
     old path. Write "None." if none. -->

## Checklist

- [ ] Offline tests pass with no credentials (`npm test --workspaces --if-present`)
- [ ] Lint clean (`npm run lint --workspaces`)
- [ ] Tool-list smoke test updated if tools were added/renamed/removed
- [ ] README updated if the tool surface or config changed
