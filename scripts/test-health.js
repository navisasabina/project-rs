const http = require('http');
const app = require('../server/app');

// Start temporary test server on port 3001
const TEST_PORT = 3001;
const server = app.listen(TEST_PORT, () => {
  console.log(`Testing server started on port ${TEST_PORT}`);

  // Test 1: GET /api/v1/health
  http.get(`http://localhost:${TEST_PORT}/api/v1/health`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (res.statusCode === 200 && json.status === 'ok') {
          console.log('PASS: GET /api/v1/health returned 200 with status: "ok"');
        } else {
          console.error('FAIL: Unexpected response:', res.statusCode, json);
          process.exit(1);
        }
      } catch (err) {
        console.error('FAIL: JSON parsing error:', err);
        process.exit(1);
      }

      // Test 2: GET / (User Portal Index)
      http.get(`http://localhost:${TEST_PORT}/`, (resIndex) => {
        let htmlData = '';
        resIndex.on('data', chunk => htmlData += chunk);
        resIndex.on('end', () => {
          if (resIndex.statusCode === 200 && htmlData.includes('Portal Panduan Hardware IT - RS Awal Bros')) {
            console.log('PASS: GET / serves existing index.html User Portal perfectly');
            server.close(() => {
              console.log('ALL M0 ACCEPTANCE TESTS PASSED!');
              process.exit(0);
            });
          } else {
            console.error('FAIL: User Portal could not be loaded cleanly');
            process.exit(1);
          }
        });
      });
    });
  }).on('error', (err) => {
    console.error('FAIL: HTTP request error:', err);
    process.exit(1);
  });
});
