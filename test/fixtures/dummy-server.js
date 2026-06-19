// test fixture: a tiny http server that binds a port and can fork a child
// holding its own handle, so tests can verify whole-process-tree termination.
import http from 'http';
import { spawn } from 'child_process';

const port = parseInt(process.env.DUMMY_PORT || process.argv[2] || '0', 10);

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
});

server.on('error', (err) => {
  // surface bind failures the same way a real service would
  console.error(`${err.code || 'ERR'}: ${err.message}`);
  process.exit(1);
});

server.listen(port, () => {
  const actual = server.address().port;
  console.log(`listening on port ${actual}`);

  if (process.env.DUMMY_FORK_CHILD === '1') {
    // a long-lived child in the same process group; group-kill must reap it
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    console.log(`child pid ${child.pid}`);
  }
});

// keep alive until killed
process.on('SIGTERM', () => process.exit(0));
