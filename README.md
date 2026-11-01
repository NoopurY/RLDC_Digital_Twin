# RLDC Motor Digital Twin

**Simulate -> Stress -> Analyze -> Diagnose -> Predict**

RLDC Motor Digital Twin is a software-defined laboratory for exploring motor
faults with synthetic vibration, current, temperature, and speed signals. It
combines a physics-inspired motor simulation with real DSP processing,
explainable fault diagnosis, and health tracking. No physical motor is
required.

## Features

- Simulate healthy and faulty RLDC motor behavior.
- Inject faults immediately, progressively, or in combination.
- Inspect time-domain signals, FFT spectra, and spectrograms on one timeline.
- Analyse frequency content with the DFT, a radix-2 FFT, and IFFT reconstruction.
- Design Butterworth and Chebyshev Type-I IIR filters (low-, high-, band-pass;
  bilinear or impulse-invariant transformation) and apply them to motor signals.
- Diagnose faults with rule-based evidence and an explainable health score.
- Compare healthy vs faulty motors, original vs filtered signals, and filter designs.
- Use the scripted Professor Demo for a guided presentation.

## Requirements

- Node.js 18 or newer
- npm
- MongoDB (optional)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The application stores data in `.data/store.json` by default. To use MongoDB,
copy `.env.example` to `.env.local` and set `MONGODB_URI`.

## Verification

Run the engine self-test before committing changes:

```bash
npm run verify
```

The verification script covers FFT/DFT/IFFT, the live-pipeline filters, PSD
Parseval checks, every IIR design configuration (stability, cut-off gain,
filtered-tone amplitude), fault detection, and false-positive checks.

Other useful commands:

```bash
npm run build       # Create a production build
npm run start       # Serve the production build
```

## Application routes

| Route | Purpose |
| --- | --- |
| `/simulator` | Main motor twin, fault injection, signal analysis, diagnosis, and health evolution |
| `/dsp` | Two modules: **Frequency Analysis (DFT & FFT)** and **Digital Filtering (IIR)** |
| `/compare` | Healthy vs faulty, original vs filtered, and filter comparison (family, order, cut-off) |

Older routes (`/fault-lab`, `/experiments`, `/architecture`, `/scenarios`,
`/model`, `/about`) redirect to `/simulator`.

### DSP Analysis

Each module follows the same steps: select input → configure → execute →
visualize → mathematics → engineering relevance. Inputs are the motor vibration
or armature current (re-generated from the simulator's current operating point
and faults, read-only) or a clean test signal.

- **Frequency Analysis (DFT & FFT)** — N = 64/128/256/512 (non-power-of-two N
  runs the DFT only), time/frequency view, dominant frequency, frequency
  resolution Δf = f_s/N, f_rot = RPM/60 with 2× and 3× harmonics, DFT-vs-FFT
  check, and IFFT reconstruction overlay.
- **Digital Filtering (IIR)** — Butterworth or Chebyshev Type-I, low/high/band-
  pass, order 2/4/6, bilinear (pre-warped) or impulse-invariant design,
  coefficients and H(z), pole stability, original/filtered waveforms, magnitude
  response, measured SNR improvement on the noisy test signal, and a warning
  when a filter removes the bearing-resonance band.

## Project structure

```text
app/
  simulator/       Main digital-twin experience
  dsp/             Frequency Analysis (DFT & FFT) and Digital Filtering (IIR)
  compare/         Healthy/faulty, original/filtered, and filter comparison
components/        Reusable UI and visualization components
lib/
  simulation/      Motor, mechanical, electrical, thermal, and signal models
  dsp/             FFT, DFT, filters, STFT, PSD, statistics, features,
                   iirDesign (lab IIR design), frequencyAnalysis, labSignals
  diagnosis/       Fault rules, classifier, explanations, health, and prognosis
  engine/          Live twin loop, data sources, demo, and sound
scripts/          Engine verification
archive/            Archived optional machine-learning classifier
```

Raw samples remain in browser ring buffers. Persistent storage contains
experiment, scenario, session, and summary data rather than full signal
streams.

## Data sources

The engine currently supports simulation and is structured for future CSV and
streaming sources. The source abstraction is implemented in
`lib/engine/sources.js`.

## Limitations

- Signals are synthetic and are not fitted to a specific motor.
- Fault models are physics-inspired approximations.
- The thermal time constant is compressed for demonstration.
- The 3D motor rotation is intentionally slowed for visualization.
- Degradation and prognosis are model-based estimates, not validated failure
  predictions.

## Contributing

Keep commits focused and descriptive. Before opening a pull request:

1. Run `npm run verify`.
2. Run `npm run build`.
3. Review the diff with `git diff --check` and `git diff`.
4. Document user-visible behavior changes in this README when appropriate.
