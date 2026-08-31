## ADDED Requirements

### Requirement: Local Speech-to-Text Benchmark Harness
The system SHALL provide a standardized local STT benchmark harness that measures inference throughput, real-time factor (RTF), and memory utilization across available compute backends.

#### Scenario: Running local STT benchmark on bundled sample
- **WHEN** the benchmark command is invoked for an installed local STT model
- **THEN** it SHALL execute inference against a standardized bundled 30-second 16 kHz audio sample
- **AND** record audio duration, inference wall-clock duration, calculated RTF, model load latency, and peak memory/VRAM
- **AND** persist the result entry tagged with model, compute backend, device, and timestamp

#### Scenario: Comparing accelerator against CPU baseline
- **WHEN** benchmarking an accelerator backend (such as CUDA)
- **THEN** the harness SHALL measure both the accelerator backend and the CPU backend on that machine
- **AND** calculate the relative speedup factor (e.g. `RTF_cpu / RTF_gpu`)
- **AND** verify that accelerated execution is faster than CPU before endorsing the backend as recommended
