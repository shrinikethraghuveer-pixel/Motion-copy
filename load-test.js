import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // Simulates traffic ramping up to 100 concurrent users over 30 seconds, 
  // holding steady, and then ramping back down.
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  // Targets your local production build running on port 3000
  const res = http.get('http://localhost:3000');
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}