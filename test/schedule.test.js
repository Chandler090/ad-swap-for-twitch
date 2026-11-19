// Checks the arithmetic in schedule.js. Run:  node test/schedule.test.js
const S = require('../schedule.js');

let failures = 0;
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) failures++;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

// Play the list round and round from a start point for `left` seconds; say where it ends up.
function playFor(durations, start, left) {
  let i = start.index, t = start.offset, remaining = left, ends = 0;
  for (let guard = 0; guard < 100000; guard++) {
    const toEnd = durations[i] - t;
    if (remaining < toEnd - 1e-9) return { index: i, time: t + remaining, videosFinished: ends };
    remaining -= toEnd;
    ends++;
    i = (i + 1) % durations.length;
    t = 0;
    if (remaining < 1e-9) return { index: i, time: 0, videosFinished: ends, justFinished: (i + durations.length - 1) % durations.length };
  }
  throw new Error('did not finish');
}

// --- order ---
check('in order: 0,1,2,3', JSON.stringify(S.order(4, false)) === '[0,1,2,3]');
let seq = [0.1, 0.9, 0.4, 0.7, 0.2];
let k = 0;
const shuffled = S.order(5, true, () => seq[k++ % seq.length]);
check('shuffled: every video still appears exactly once', shuffled.slice().sort().join() === '0,1,2,3,4');
check('shuffled: the order really changes', shuffled.join() !== '0,1,2,3,4');
let different = 0;
for (let i = 0; i < 50; i++) if (S.order(6, true).join() !== '0,1,2,3,4,5') different++;
check('shuffled: with real randomness it is almost never the plain order', different >= 45);
check('one video: nothing to shuffle', S.order(1, true).join() === '0');
check('no videos: empty', S.order(0, true).length === 0);

// --- finishing with the break ---
// One 10-second video, 86 seconds of ads: join it 4 seconds in, it goes round and ends on time.
let st = S.start([10], 86);
check('one short video, long break: joins part-way in', st.index === 0 && near(st.offset, 4));
let end = playFor([10], st, 86);
check('...and its last pass ends exactly when the break does', end.justFinished === 0 && end.videosFinished === 9);

// Three videos longer than the break: starts in the middle, ends with the LAST one.
st = S.start([60, 45, 30], 50);
check('list longer than the break: starts inside the second video', st.index === 1 && near(st.offset, 25));
end = playFor([60, 45, 30], st, 50);
check('...and finishes on the end of the last video in the list', end.justFinished === 2);

// A break exactly as long as the list: start at the very beginning.
st = S.start([20, 40], 60);
check('break exactly as long as the list: starts at the beginning', st.index === 0 && near(st.offset, 0));
check('...and ends on the last video', playFor([20, 40], st, 60).justFinished === 1);

// Many different cases: it always lands on the end of the last video.
let allGood = true;
for (const durs of [[7], [12.5, 3.25], [33, 61, 18.4, 5], [120, 240], [0.8, 0.9, 1.1]]) {
  for (const left of [1, 15, 29.5, 30, 60, 86, 179, 180, 600]) {
    const s0 = S.start(durs, left), e = playFor(durs, s0, left);
    if (e.justFinished !== durs.length - 1) { allGood = false; console.log('  miss:', durs, left, s0, e); }
  }
}
check('across 45 mixes of video lengths and break lengths, it always ends on the last video', allGood);

check('lengths not known: just start at the beginning', JSON.stringify(S.start([10, Infinity], 30)) === '{"index":0,"offset":0}');
check('time left not known: just start at the beginning', JSON.stringify(S.start([10, 20], null)) === '{"index":0,"offset":0}');
check('no videos: start at the beginning', JSON.stringify(S.start([], 30)) === '{"index":0,"offset":0}');

// --- staying on plan ---
st = S.start([60, 45, 30], 50);
check('on plan at the start: no gap', near(S.drift([60, 45, 30], st.index, st.offset, 50), 0));
check('ten seconds later, still on plan', near(S.drift([60, 45, 30], 1, 35, 40), 0));
check('break has 5 more seconds than we need: we would finish early (+5)', near(S.drift([60, 45, 30], 1, 35, 45), 5));
check('break has 5 fewer seconds than we need: we would finish late (-5)', near(S.drift([60, 45, 30], 1, 35, 35), -5));
check('a looping single video is judged the same way', near(S.drift([10], 0, 4, 86), 0) && near(S.drift([10], 0, 6, 86), 2));
check('nothing to plan against: no gap reported', S.drift([10, NaN], 0, 3, 30) === 0);

check('about half a second out: leave the speed alone', S.rate(0.5) === 1 && S.rate(-0.55) === 1);
check('a second out: a 5% change', S.rate(1) === 0.95 && S.rate(-1) === 1.05);
check('finishing early: slow down; finishing late: speed up', S.rate(0.8) === 0.96 && S.rate(-0.8) === 1.04);
check('a bigger gap gets a bigger change', S.rate(1.2) < S.rate(0.8) && S.rate(-1.2) > S.rate(-0.8));
check('never more than 8% either way, however far out', S.rate(100) === 0.92 && S.rate(-100) === 1.08);

console.log(failures === 0 ? '\nALL PASSED' : '\n' + failures + ' FAILED');
process.exit(failures ? 1 : 0);
