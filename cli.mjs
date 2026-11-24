#!/usr/bin/env node
// Connexion à Bobbee (pool dev, sert aux éphémères) depuis un terminal : node cli.mjs login | logout | status.
import { createInterface } from 'node:readline/promises';
import { authStatus, login, logout } from './lib/auth.mjs';

// Saisie masquée du mot de passe (rien n'est affiché ni gardé).
function askHidden(label) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error('lance la commande dans un terminal interactif'));
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (fn) => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); fn(); };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(value));
        if (ch === '\u0003') return done(() => reject(new Error('annulé')));
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    }
    stdin.on('data', onData);
  });
}

async function main(command) {
  if (command === 'login') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const email = await rl.question(`Email Bobbee (dev)${authStatus().email ? ` [${authStatus().email}]` : ''} : `);
    rl.close();
    const address = await login(email.trim() || authStatus().email, await askHidden('Mot de passe : '));
    console.log(`Connecté en ${address}. Le MCP bobbee-test-data peut viser les envs éphémères.`);
  } else if (command === 'logout') {
    await logout();
    console.log('Déconnecté.');
  } else if (command === 'status') {
    console.log(authStatus());
  } else {
    console.log('Usage : node cli.mjs login | logout | status');
  }
}

main(process.argv[2]).catch((e) => { console.error(e.message); process.exit(1); });
