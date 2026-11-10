import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-server endpoints for the district placement editor (Phase 7 piece C; district.html):
 * `POST /__district/save?file=bayfield.json` writes the layout to data/districts/ (checked
 * against the schema, formatted with prettier), and `POST /__district/bake?bake=bayfield`
 * runs `npm run district:bake` for that district. Only in `vite` dev, never in a build.
 */
export function districtEditorPlugin(): Plugin {
  return {
    name: 'glp-district-editor',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/__district/', (req, res) => {
        const url = new URL(req.url ?? '', 'http://dev');
        const fail = (code: number, text: string): void => {
          res.statusCode = code;
          res.end(text);
        };
        if (req.method !== 'POST') return fail(405, 'POST only');
        if (url.pathname === '/save') {
          const file = url.searchParams.get('file') ?? '';
          if (!/^[a-z0-9_]+\.json$/.test(file)) return fail(400, 'bad file name');
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            void (async () => {
              try {
                const json: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const { parseLayout } = (await server.ssrLoadModule(
                  '/src/sim/district/layout.ts',
                )) as typeof import('../../src/sim/district/layout');
                parseLayout(json);
                const prettier = await import('prettier');
                const path = join(root, 'data', 'districts', file);
                const options = (await prettier.resolveConfig(path)) ?? {};
                const text = await prettier.format(JSON.stringify(json), {
                  ...options,
                  parser: 'json',
                });
                writeFileSync(path, text);
                res.end('ok');
              } catch (e) {
                fail(400, String(e));
              }
            })();
          });
          return;
        }
        if (url.pathname === '/bake') {
          const bake = url.searchParams.get('bake') ?? '';
          if (!/^[a-z0-9_]+$/.test(bake)) return fail(400, 'bad district');
          const child = spawn('npm', ['run', 'district:bake'], {
            cwd: root,
            env: { ...process.env, DISTRICT: bake },
          });
          let out = '';
          child.stdout.on('data', (c: Buffer) => (out += c.toString()));
          child.stderr.on('data', (c: Buffer) => (out += c.toString()));
          child.on('close', (code) => (code === 0 ? res.end(out) : fail(500, out)));
          return;
        }
        fail(404, 'unknown');
      });
    },
  };
}
