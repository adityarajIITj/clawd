// Quests: three per world, chosen by the level file. Each earns one quest star.
// `s` is the run's stats: { sparks, sparkTotal, tokens, heartsLost, time, par,
//   stomped, enemyTotal, crates, crateTotal, finished }.
import { fmtTime } from './ui.js';

export const BONUS_STARS = 12; // quest stars needed to open the bonus world

export const QUESTS = {
  all_sparks: {
    label: (W) => `Collect every ${W.spark.toLowerCase()}`,
    progress: (s) => `${s.sparks} / ${s.sparkTotal}`,
    done: (s) => s.sparks >= s.sparkTotal,
    live: true,
  },
  tokens: {
    label: (W) => `Find all three ${W.tokens}`,
    progress: (s) => `${s.tokens} / 3`,
    done: (s) => s.tokens >= 3,
    live: true,
  },
  stomp_all: {
    label: () => 'Stomp every enemy',
    progress: (s) => `${s.stomped} / ${s.enemyTotal}`,
    done: (s) => s.stomped >= s.enemyTotal,
    live: true,
  },
  crates: {
    label: () => 'Smash every crate',
    progress: (s) => `${s.crates} / ${s.crateTotal}`,
    done: (s) => s.crates >= s.crateTotal,
    live: true,
  },
  no_hurt: {
    label: () => 'Finish without losing a heart',
    progress: (s) => (s.heartsLost ? 'missed this run' : 'so far so good'),
    done: (s) => s.finished && s.heartsLost === 0,
    failed: (s) => s.heartsLost > 0,
  },
  par: {
    label: (W, s) => `Finish in under ${fmtTime(s.par).slice(0, -3)}`,
    progress: (s) => (s.time > s.par ? 'missed this run' : `${fmtTime(Math.max(0, s.par - s.time)).slice(0, -3)} left`),
    done: (s) => s.finished && s.time <= s.par,
    failed: (s) => s.time > s.par,
  },
};

// Markup for a quest list. `earned` = quests already completed in the save file.
export function questList(ids, W, stats, earned = {}, { showProgress = true, justNow = null } = {}) {
  return `<div class="quests">${ids.map((id) => {
    const q = QUESTS[id];
    if (!q) return '';
    const got = !!earned[id];
    const now = stats ? q.done(stats) : false;
    const fail = stats && q.failed && q.failed(stats) && !now;
    const state = now || got ? 'done' : fail ? 'fail' : '';
    const fresh = justNow && justNow.includes(id);
    return `<div class="quest ${state}">
      <i class="q-star">★</i>
      <span class="q-label">${q.label(W, stats || { par: 0 })}</span>
      ${fresh ? '<em class="q-new">new!</em>' : ''}
      ${showProgress && stats && !now ? `<span class="q-prog">${q.progress(stats)}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

export function countStars(save) {
  let n = 0;
  for (const rec of Object.values(save.levels || {})) n += Object.values(rec.quests || {}).filter(Boolean).length;
  return n;
}
