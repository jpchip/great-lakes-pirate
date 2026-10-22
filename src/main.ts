import { createTestScene } from './render/test-scene';

// Phase 0 bootstrap: a placeholder scene so the build, deploy and smoke test have
// something to boot. The core skeleton (loop, modes, events, rng…) lands separately.
const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

createTestScene(container);
