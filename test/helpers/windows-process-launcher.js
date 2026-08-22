const { spawn } = require('node:child_process');

const payload = JSON.parse(
  Buffer.from(process.argv[2], 'base64').toString('utf8')
);
const readyPath = process.argv[3];

process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  const child = spawn(payload.command, payload.args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  child.once('spawn', () => {
    require('node:fs').writeFileSync(readyPath, '');
  });
  child.once('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once('close', (code) => {
    process.exitCode = code ?? 1;
  });
});
