# Progressive sync performance budgets

The release gate uses two reference profiles:

| Profile | Reference | First usable UI overhead | Sync long tasks before usability | Peak JS heap attributable to sync | Projection transaction |
|---|---|---:|---:|---:|---:|
| Desktop | macOS/Windows/Linux, 4-core CPU, 8 GB RAM | <=100 ms vs sync-disabled | 0 tasks >50 ms | <=128 MiB | <=100 rows / 256 KiB |
| Low-tier mobile | Android WebView, 4 GB device, 2-core constrained runtime | <=100 ms vs sync-disabled | 0 tasks >50 ms | <=64 MiB | <=50 rows / 128 KiB |

Catch-up work is measured on small, large, and ten-year fixtures. P0 state must become available before P1/P2 library replay; lower lanes may take longer but must make forward progress. Battery and data constraints pause P2/P3 work when the platform reports power-save, background, or save-data conditions; when unavailable, the scheduler uses its conservative default slice.

These are release-gate defaults, not promises about every device. A benchmark run records device/runtime, fixture size, first paint, local usability, provider setup, replay, projection, peak memory, long tasks, and catch-up time. Any intentional budget change requires updating this file and the benchmark fixture in the same change.
