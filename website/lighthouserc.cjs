module.exports = {
  ci: {
    collect: {
      url: ['http://127.0.0.1:4321/'],
      numberOfRuns: 3,
      startServerCommand: 'npm run preview -- --host 127.0.0.1 --port 4321',
      startServerReadyPattern: 'localhost:4321|127.0.0.1:4321',
    },
    assert: {
      assertions: {
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-byte-weight': ['warn', { maxNumericValue: 800000 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
