const http = require('http');
const fs = require('fs');
const path = require('path');

const pdf = fs.readFileSync(path.join(__dirname, 'hello.pdf'));
const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const body = Buffer.concat([
  Buffer.from(
    '--' +
      boundary +
      '\r\nContent-Disposition: form-data; name="file"; filename="hello.pdf"\r\nContent-Type: application/pdf\r\n\r\n'
  ),
  pdf,
  Buffer.from('\r\n--' + boundary + '--\r\n'),
]);

const req = http.request(
  {
    hostname: '127.0.0.1',
    port: 8799,
    path: '/api/files/import',
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': body.length,
    },
  },
  (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      console.log('status', res.statusCode);
      console.log(d.slice(0, 800));
      process.exit(res.statusCode === 200 ? 0 : 1);
    });
  }
);
req.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
req.write(body);
req.end();
