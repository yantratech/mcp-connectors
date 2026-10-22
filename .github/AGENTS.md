# Downloaded CI executables

- Verify downloaded executable archives against a reviewed, pinned checksum before extraction or
  execution. Fetching a checksum alongside an untrusted archive at runtime is not an independent
  trust anchor.

- Download and extract into an isolated temporary directory and clean it on success and failure.
  Version and checksum changes must be reviewed together; fail closed on verification errors.
