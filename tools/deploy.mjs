// npm run deploy — pubblica tutto:
// 1. legge i PDF in data/ e aggiorna docs/bollette.json
// 2. fa commit di ogni modifica (dati e pagina) e push su GitHub
// GitHub Pages (branch main, cartella /docs) ripubblica la pagina in circa un minuto.
// I PDF non vengono mai pubblicati: data/ e *.pdf sono in .gitignore, e qui c'è un controllo in più.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, quiet = false) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
const git = (...args) => run('git', args, true).trim();

if (!git('remote')) {
  console.error('Manca il repository remoto: crealo con  gh repo create <utente>/costi-elettricita --public --source . --remote origin --push');
  process.exit(1);
}

// 1. dati dalle bollette
run(process.execPath, ['tools/build-data.mjs', 'data']);

// 2. commit di tutte le modifiche
run('git', ['add', '-A']);
const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean);
const unsafe = staged.filter((f) => /\.pdf$/i.test(f) || f.startsWith('data/'));
if (unsafe.length) {
  run('git', ['reset', '-q']);
  console.error(`Fermato: stavo per pubblicare file con dati personali:\n  ${unsafe.join('\n  ')}`);
  process.exit(1);
}
if (staged.length) {
  const what = staged.includes('docs/bollette.json') ? 'Aggiorna bollette' : 'Aggiorna pagina';
  run('git', ['commit', '-q', '-m', `${what} (${new Date().toISOString().slice(0, 10)})`]);
  console.log(`Commit: ${staged.join(', ')}`);
}

// 3. push se ci sono commit non ancora pubblicati
run('git', ['fetch', '-q']);
const ahead = Number(git('rev-list', '--count', '@{u}..HEAD') || 0);
if (!ahead) {
  console.log('Già tutto pubblicato: niente di nuovo da mandare su GitHub.');
  process.exit(0);
}
run('git', ['push', '-q']);
console.log(`\nPubblicato (${ahead} commit). La pagina si aggiorna su https://robotlabs.github.io/costi-elettricita/ tra circa un minuto.`);
