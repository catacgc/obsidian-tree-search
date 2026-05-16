### Accepted
(none)

### Dismissed
- [x] [Warning] **`npm run build --if-present` deviates from spec's `npm run build`** — While technically a spec-implementation mismatch, this is immaterial. The `build` script exists in `package.json:10` and will always exist (it's the project's core build command), making `--if-present` functionally identical to its absence. Even in the hypothetical scenario where the script were removed, the immediately following `ls -la dist/main.js` step (line 62-63) would fail the job because no `dist/main.js` would be produced. This is a common CI authoring convention (defensive scripting), not a correctness issue, and has zero impact on the CI workflow's ability to catch regressions.