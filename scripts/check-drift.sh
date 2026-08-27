#!/usr/bin/env bash
# Tree-drift check (SPEC plan A4). secure/ and vulnerable/ must differ in EXACTLY these six files —
# a seventh divergence is a bug and fails the check. This turns "any other divergence is a bug"
# (SPEC §5) from an intention into a gate. Run from the repo root: bash scripts/check-drift.sh
set -u

EXPECTED=$(cat <<'LIST'
.env.example
public/js/system.js
routes/auth.js
routes/customers.js
routes/password.js
tests/attacks.test.js
LIST
)
EXPECTED_SORTED=$(printf '%s\n' "$EXPECTED" | sort)

RAW=$(diff -rq secure vulnerable -x node_modules -x .env -x .env.test -x package-lock.json)

# Files present in only one tree are always a failure.
ONLY=$(printf '%s\n' "$RAW" | grep '^Only in ' || true)
if [ -n "$ONLY" ]; then
  echo "check-drift FAIL — files exist in only one tree:"
  printf '%s\n' "$ONLY" | sed 's/^/  /'
  exit 1
fi

ACTUAL=$(printf '%s\n' "$RAW" \
  | sed -n 's#^Files secure/\(.*\) and vulnerable/.* differ$#\1#p' | sort)

if [ "$ACTUAL" = "$EXPECTED_SORTED" ]; then
  echo "check-drift ok — exactly the 6 expected files differ:"
  printf '%s\n' "$ACTUAL" | sed 's/^/  /'
  exit 0
fi

echo "check-drift FAIL — the differing files are not the expected six."
echo "expected:"; printf '%s\n' "$EXPECTED_SORTED" | sed 's/^/  /'
echo "actual:";   printf '%s\n' "$ACTUAL" | sed 's/^/  /'
exit 1
