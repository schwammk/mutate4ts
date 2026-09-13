# Fixture project

Hand-computed mutation fixture (see the implementation plan Task 8):
pricing.ts has 12 sites — 9 killed, 2 survived, 1 not-covered by the stub runner.
clean-pricing.ts is the all-killed variant used by the manifest-certification test.
run-tests.js is the stub "test command" (exit code is the only signal).
coverage/lcov.info is a handcrafted LCOV matching the fixture's units (exactly, so it is not stale).
