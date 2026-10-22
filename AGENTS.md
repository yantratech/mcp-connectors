# CI credential handling

- Set `persist-credentials: false` on read-only checkouts. Give each job only the permissions it
  needs. Jobs that push must use an explicitly authenticated write step rather than relying on
  checkout credentials.

- Preserve full-history checkout for secret scanning.
