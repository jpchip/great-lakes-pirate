import { createTestScene } from './render/test-scene';

// Phase 0 bootstrap: a placeholder scene so the build and smoke test have something
// to boot. The core skeleton (loop, modes, events, rng…) lands separately.
const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

// `?renderer=null` boots without WebGL. CI has no GPU, so its smoke test uses this
// (plan 01 §9); rendering is checked locally.
const rendererKind = new URLSearchParams(window.location.search).get('renderer');
if (rendererKind !== 'null') createTestScene(container);
document.body.dataset['renderer'] = rendererKind === 'null' ? 'null' : 'webgl';
