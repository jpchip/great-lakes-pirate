import { runS6 } from './measure';

const out = document.getElementById('out') as HTMLPreElement;

runS6().then(
  (result) => {
    out.textContent = JSON.stringify(result, null, 2);
    document.body.dataset.s6 = 'done';
  },
  (err: unknown) => {
    out.textContent = String(err);
    document.body.dataset.s6 = 'failed';
  },
);
