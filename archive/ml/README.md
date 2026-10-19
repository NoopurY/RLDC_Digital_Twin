# Archived: optional ML classifier

Random Forest classifier, synthetic dataset generator, Web Worker trainer and the
former "Model Performance" page. Removed from the app to keep it focused on the
transparent rule engine (the brief: "Start with transparent deterministic rules.
Optional ML can be added later."). To restore, move the files back to:

- randomForest.js → lib/diagnosis/
- dataset.js → lib/simulation/
- train.worker.js → lib/workers/
- model-page.js → app/model/page.js
- mlFeatures.js → append to lib/dsp/features.js
- train-check.mjs → scripts/
