# Measuring impact

This is a protocol for measuring what Trace2Test changes, and a table for the results. **The manual column is for you to fill.** Nothing in this table has been measured yet, and no number belongs in the README until it has been.

One seeded bug timed three times is a demonstration, not a study. Say so wherever these numbers appear, and state the sample size beside every figure.

## Protocol

### Manual baseline

1. Have someone who did not write the seeded bug read only the customer complaint: "Checkout fails when I use my coupon and pay by UPI."
2. Give them the repository with the fix not applied, the production logs (CloudWatch) and the staging URL. Do not show them the dashboard.
3. Start a stopwatch when they start reading the complaint.
4. **Time to reproduce:** stop the first lap when they see the failure on their own machine or on staging.
5. **Time to a regression test:** stop the second lap when they have a test that fails because of this bug.
6. Repeat with three people, or three separate attempts, and record each run.

### With Trace2Test

1. Run `scripts/trigger-bug.sh` (or pay with READ15 and UPI on `/shop`).
2. **Time to reproduce:** read the incident's step timings in the dashboard, from Captured to the end of Compare.
3. **Time to a regression test:** read the capture-to-test time on the incident (the "Median capture to test" figure is the median of these).
4. Repeat three times on fresh incidents. Delete the earlier incident, or change the cart so the fingerprint differs, so each run goes through the full pipeline.
5. **Reproduction rate** and **sensitive values left after redaction** come from `GET /metrics` (`reproducedPercent`, `leaks`).

## Results

| Metric | How it is measured | Manual | With Trace2Test |
| --- | --- | --- | --- |
| Time to reproduce | Stopwatch, from reading the complaint to seeing the failure locally; three runs | | |
| Time to a regression test | Stopwatch to a failing test that targets the bug | | |
| Reproduction rate | Reproduced incidents ÷ replayable incidents | not applicable | |
| Sensitive values left after redaction | Leak scan count across all bundles | not applicable | |

Sample size: ___ runs (manual), ___ runs (with Trace2Test). Date measured: ___.
