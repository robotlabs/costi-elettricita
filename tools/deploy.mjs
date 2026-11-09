// npm run deploy — legge i PDF in data/, aggiorna docs/bollette.json, fa commit e push.
// GitHub Actions poi pubblica la pagina su GitHub Pages (circa un minuto).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit' });

run(process.execPath, ['tools/build-data.mjs', 'data']);

const changed = run('git', ['status', '--porcelain', '--', 'docs/bollette.json'], { quiet: true }).trim();
if (!changed) {
  console.log('Nessuna bolletta nuova: niente da pubblicare.');
  process.exit(0);
}

const remote = run('git', ['remote'], { quiet: true }).trim();
if (!remote) {
  console.error('Manca il repository remoto (git remote). Crealo prima con: gh repo create <utente>/costi-elettricita --public --source . --remote origin --push');
  process.exit(1);
}

// committa solo i dati, anche se ci sono altre modifiche in corso
run('git', ['add', 'docs/bollette.json']);
run('git', ['commit', '-m', `Aggiorna bollette (${new Date().toISOString().slice(0, 10)})`, '--only', 'docs/bollette.json']);
run('git', ['push']);
console.log('\nFatto. La pagina si aggiorna su GitHub Pages tra circa un minuto.');
