const https = require("https");
const fs = require("fs");
const path = require("path");

const USERNAME = "ayushmishra12345";
const GRAPHQL_URL = "https://leetcode.com/graphql";
const SVG_PATH = path.join(__dirname, "..", "leetcode-stats.svg");

function graphql(query, variables) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const url = new URL(GRAPHQL_URL);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent": "Mozilla/5.0",
        Referer: "https://leetcode.com/",
      },
    };
    const req = https.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("Failed to parse GraphQL response"));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function fetchStats() {
  const profileQuery = `
    query userProfile($username: String!) {
      matchedUser(username: $username) {
        submitStats {
          acSubmissionNum { difficulty count submissions }
          totalSubmissionNum { difficulty count submissions }
        }
        profile { ranking }
      }
      allQuestionsCount { difficulty count }
    }
  `;
  const badgesQuery = `
    query userBadges($username: String!) {
      matchedUser(username: $username) {
        badges { id displayName icon creationDate }
      }
    }
  `;
  const calendarQuery = `
    query userProfileCalendar($username: String!, $year: Int) {
      matchedUser(username: $username) {
        userCalendar(year: $year) {
          streak totalActiveDays submissionCalendar
        }
      }
    }
  `;

  const [profile, badges, calendar] = await Promise.all([
    graphql(profileQuery, { username: USERNAME }),
    graphql(badgesQuery, { username: USERNAME }),
    graphql(calendarQuery, { username: USERNAME, year: 2026 }),
  ]);

  const data = profile?.data;
  if (!data?.matchedUser) throw new Error("User not found or API rate limited");

  const ac = data.matchedUser.submitStats.acSubmissionNum;
  const total = data.allQuestionsCount;

  const get = (arr, diff) => arr.find((d) => d.difficulty === diff) || { count: 0, submissions: 0 };

  const stats = {
    solved: {
      total: get(ac, "All").count,
      easy: get(ac, "Easy").count,
      medium: get(ac, "Medium").count,
      hard: get(ac, "Hard").count,
    },
    totalQ: {
      total: get(total, "All").count,
      easy: get(total, "Easy").count,
      medium: get(total, "Medium").count,
      hard: get(total, "Hard").count,
    },
    submissions: {
      total: get(ac, "All").submissions,
    },
    badges: badges?.data?.matchedUser?.badges || [],
    calendar: calendar?.data?.matchedUser?.userCalendar || {},
    ranking: data.matchedUser.profile.ranking || 0,
  };

  stats.attempting = stats.totalQ.total - stats.solved.total;
  stats.ratio = stats.totalQ.total > 0 ? stats.solved.total / stats.totalQ.total : 0;

  return stats;
}

function parseCalendar(calStr) {
  if (!calStr) return {};
  try {
    return JSON.parse(calStr);
  } catch {
    return {};
  }
}

function generateSVG(stats) {
  const calData = parseCalendar(stats.calendar.submissionCalendar);
  const W = 1000;

  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setDate(oneYearAgo.getDate() - 364);

  const dayMap = {};
  for (const [ts, count] of Object.entries(calData)) {
    const d = new Date(Number(ts) * 1000);
    const key = d.toISOString().slice(0, 10);
    dayMap[key] = count;
  }

  const cells = [];
  const startDay = new Date(oneYearAgo);
  const dayOfWeek = startDay.getDay();
  startDay.setDate(startDay.getDate() - dayOfWeek);

  let current = new Date(startDay);
  const endDate = new Date(now);
  while (current <= endDate) {
    const key = current.toISOString().slice(0, 10);
    const count = dayMap[key] || 0;
    cells.push({ date: key, count, day: current.getDay() });
    current.setDate(current.getDate() + 1);
  }

  const weeks = [];
  let w = [];
  for (const c of cells) {
    w.push(c);
    if (w.length === 7) {
      weeks.push(w);
      w = [];
    }
  }
  if (w.length > 0) weeks.push(w);

  const monthLabels = getMonthLabels(startDay, now, weeks.length);
  const maxCount = Math.max(...cells.map((c) => c.count), 1);
  const heatColors = ["#1a1a1a", "#0E4429", "#006D32", "#26A641", "#39D353"];

  function getHeatColor(count) {
    if (count === 0) return heatColors[0];
    const ratio = count / maxCount;
    if (ratio <= 0.25) return heatColors[1];
    if (ratio <= 0.5) return heatColors[2];
    if (ratio <= 0.75) return heatColors[3];
    return heatColors[4];
  }

  const totalActiveDays = stats.calendar.totalActiveDays || 0;
  const maxStreak = stats.calendar.streak || 0;
  const submissionCount = stats.submissions.total || 0;

  const CARD_BG = "#1a1a1a";
  const TEXT_GRAY = "#8b949e";
  const TEXT_WHITE = "#ffffff";

  const c1x = 20, c1w = 570, c1h = 240, c1y = 20;
  const c2x = c1x + c1w + 20, c2w = 390, c2h = 240, c2y = 20;
  const c3x = 20, c3w = 960, c3y = c1h + 40, c3h = 260;

  const ringCx = 160, ringCy = 120, ringR = 72;
  const circ = 2 * Math.PI * ringR;
  const arcDeg = 270;
  const arcLen = circ * (arcDeg / 360);
  const progress = Math.min(stats.ratio, 1);
  const progLen = arcLen * progress;
  const gapLen = circ - progLen;

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const badgeSize = 40;
  const badgeGap = 10;
  const badgeStartX = c2x + 30;
  const badgeStartY = c2y + 70;
  const maxBadges = 6;
  const recentBadge = stats.badges.length > 0 ? stats.badges[0] : null;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${c3y + c3h + 20}" viewBox="0 0 ${W} ${c3y + c3h + 20}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <defs>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFD700" />
      <stop offset="50%" stop-color="#00CED1" />
      <stop offset="100%" stop-color="#FF4444" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.4" />
    </filter>
  </defs>
`;

  // ── Card 1: Stats Overview ──
  svg += `  <rect x="${c1x}" y="${c1y}" width="${c1w}" height="${c1h}" rx="12" fill="${CARD_BG}" filter="url(#shadow)" />\n`;

  // Progress ring track (270°)
  svg += `  <circle cx="${ringCx}" cy="${ringCy}" r="${ringR}" fill="none" stroke="#333" stroke-width="10" stroke-dasharray="${arcLen} ${circ - arcLen}" stroke-linecap="round" transform="rotate(-135 ${ringCx} ${ringCy})" />\n`;

  // Progress ring fill
  if (progLen > 1) {
    svg += `  <circle cx="${ringCx}" cy="${ringCy}" r="${ringR}" fill="none" stroke="url(#ringGrad)" stroke-width="10" stroke-dasharray="${progLen} ${gapLen}" stroke-linecap="round" transform="rotate(-135 ${ringCx} ${ringCy})" />\n`;
  }

  // Center text
  svg += `  <text x="${ringCx}" y="${ringCy - 18}" text-anchor="middle" fill="${TEXT_WHITE}" font-size="32" font-weight="700">${stats.solved.total}</text>\n`;
  svg += `  <text x="${ringCx + 80}" y="${ringCy - 12}" text-anchor="start" fill="${TEXT_GRAY}" font-size="14">/ ${stats.totalQ.total}</text>\n`;
  svg += `  <text x="${ringCx}" y="${ringCy + 12}" text-anchor="middle" fill="#2ea043" font-size="13">✓ Solved</text>\n`;
  svg += `  <text x="${ringCx}" y="${ringCy + 32}" text-anchor="middle" fill="${TEXT_GRAY}" font-size="12">${stats.attempting} Attempting</text>\n`;

  // Right side: pill badges
  const pillData = [
    { label: "Easy", count: stats.solved.easy, total: stats.totalQ.easy, color: "#00B8A3" },
    { label: "Med.", count: stats.solved.medium, total: stats.totalQ.medium, color: "#FFB800" },
    { label: "Hard", count: stats.solved.hard, total: stats.totalQ.hard, color: "#FF375F" },
  ];

  const pillX = 310;
  let pillY = 54;
  const pillH = 56;
  const pillGap = 10;

  for (const p of pillData) {
    const px = pillX, py = pillY;
    svg += `  <rect x="${px}" y="${py}" width="240" height="${pillH}" rx="8" fill="#2d2d2d" />\n`;
    svg += `  <rect x="${px}" y="${py}" width="60" height="${pillH}" rx="8" fill="${p.color}" opacity="0.15" />\n`;
    svg += `  <rect x="${px + 8}" y="${py + 12}" width="44" height="${pillH - 24}" rx="6" fill="${p.color}" opacity="0.25" />\n`;
    svg += `  <text x="${px + 30}" y="${py + 30}" text-anchor="middle" fill="${p.color}" font-size="12" font-weight="700">${p.label}</text>\n`;
    svg += `  <text x="${px + 174}" y="${py + 24}" text-anchor="end" fill="${TEXT_WHITE}" font-size="22" font-weight="700">${p.count}</text>\n`;
    svg += `  <text x="${px + 182}" y="${py + 24}" text-anchor="start" fill="${TEXT_GRAY}" font-size="13">/ ${p.total}</text>\n`;
    pillY += pillH + pillGap;
  }

  // ── Card 2: Badges ──
  svg += `  <rect x="${c2x}" y="${c2y}" width="${c2w}" height="${c2h}" rx="12" fill="${CARD_BG}" filter="url(#shadow)" />\n`;

  // Header
  svg += `  <text x="${c2x + 24}" y="56" fill="${TEXT_GRAY}" font-size="13">Badges</text>\n`;
  svg += `  <text x="${c2x + 80}" y="56" fill="${TEXT_WHITE}" font-size="24" font-weight="700">${Math.min(stats.badges.length, maxBadges)}</text>\n`;
  svg += `  <text x="${c2x + c2w - 30}" y="56" fill="${TEXT_GRAY}" font-size="18" text-anchor="end">→</text>\n`;

  // Badge icons
  const badgeColors = ["#2ea043", "#58a6ff", "#d29922", "#a371f7", "#db6d28", "#f78166"];
  const badgeLabels = stats.badges.slice(0, maxBadges).map((b) => b.displayName || "Badge");
  for (let i = 0; i < Math.min(stats.badges.length, maxBadges); i++) {
    const bx = badgeStartX + i * (badgeSize + badgeGap);
    const by = badgeStartY;
    const bc = badgeColors[i % badgeColors.length];
    svg += `  <polygon points="${bx + badgeSize / 2},${by} ${bx + badgeSize},${by + badgeSize / 4} ${bx + badgeSize},${by + (3 * badgeSize) / 4} ${bx + badgeSize / 2},${by + badgeSize} ${bx},${by + (3 * badgeSize) / 4} ${bx},${by + badgeSize / 4}" fill="none" stroke="${bc}" stroke-width="2" />\n`;
    svg += `  <text x="${bx + badgeSize / 2}" y="${by + badgeSize / 2 + 4}" text-anchor="middle" fill="${TEXT_WHITE}" font-size="7" font-weight="600">${badgeLabels[i].slice(0, 8)}</text>\n`;
  }

  // Most Recent Badge
  if (recentBadge) {
    svg += `  <text x="${c2x + 24}" y="${badgeStartY + badgeSize + 32}" fill="${TEXT_GRAY}" font-size="11">Most Recent Badge</text>\n`;
    svg += `  <text x="${c2x + 24}" y="${badgeStartY + badgeSize + 52}" fill="${TEXT_WHITE}" font-size="16" font-weight="600">${recentBadge.displayName || "Unknown"}</text>\n`;
  }

  // ── Card 3: Submission Heatmap ──
  svg += `  <rect x="${c3x}" y="${c3y}" width="${c3w}" height="${c3h}" rx="12" fill="${CARD_BG}" filter="url(#shadow)" />\n`;

  // Header
  svg += `  <text x="${c3x + 24}" y="${c3y + 36}" fill="${TEXT_WHITE}" font-size="24" font-weight="700">${submissionCount}</text>\n`;
  svg += `  <text x="${c3x + 80}" y="${c3y + 36}" fill="${TEXT_GRAY}" font-size="14">submissions in the past one year</text>\n`;
  svg += `  <text x="${c3x + c3w - 24}" y="${c3y + 36}" fill="${TEXT_GRAY}" font-size="12" text-anchor="end">ⓘ</text>\n`;

  // Right stats
  svg += `  <text x="${c3x + c3w - 24}" y="${c3y + 58}" fill="${TEXT_GRAY}" font-size="11" text-anchor="end">Total active days: </text>\n`;
  svg += `  <text x="${c3x + c3w - 24}" y="${c3y + 58}" fill="${TEXT_WHITE}" font-size="11" text-anchor="end">${totalActiveDays}</text>\n`;
  svg += `  <text x="${c3x + c3w - 24}" y="${c3y + 76}" fill="${TEXT_GRAY}" font-size="11" text-anchor="end">Max streak: </text>\n`;
  svg += `  <text x="${c3x + c3w - 24}" y="${c3y + 76}" fill="${TEXT_WHITE}" font-size="11" text-anchor="end">${maxStreak}</text>\n`;

  // Heatmap grid
  const cellSize = 11;
  const cellGap = 2;
  const hmStartX = c3x + 24;
  const hmStartY = c3y + 60;
  const maxWeeks = 53;
  const displayWeeks = weeks.slice(-maxWeeks);

  // Month labels
  for (const ml of monthLabels) {
    if (ml.col < displayWeeks.length) {
      const x = hmStartX + ml.col * (cellSize + cellGap);
      svg += `  <text x="${x}" y="${hmStartY - 6}" fill="${TEXT_GRAY}" font-size="9">${esc(ml.label)}</text>\n`;
    }
  }

  // Day cells
  for (let wi = 0; wi < displayWeeks.length; wi++) {
    const week = displayWeeks[wi];
    for (let di = 0; di < week.length; di++) {
      const cell = week[di];
      const x = hmStartX + wi * (cellSize + cellGap);
      const y = hmStartY + di * (cellSize + cellGap);
      const color = getHeatColor(cell.count);
      const radius = 2;
      svg += `  <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${radius}" fill="${color}" />\n`;
    }
  }

  // Legend
  const legX = c3x + c3w - 160;
  const legY = c3y + c3h - 24;
  svg += `  <text x="${legX - 40}" y="${legY + 8}" fill="${TEXT_GRAY}" font-size="10" text-anchor="end">Less</text>\n`;
  for (let i = 0; i < heatColors.length; i++) {
    const lx = legX + i * (cellSize + 2);
    svg += `  <rect x="${lx}" y="${legY}" width="${cellSize}" height="${cellSize}" rx="2" fill="${heatColors[i]}" />\n`;
  }
  svg += `  <text x="${legX + heatColors.length * (cellSize + 2) + 4}" y="${legY + 8}" fill="${TEXT_GRAY}" font-size="10">More</text>\n`;

  svg += `</svg>\n`;
  return svg;
}

function getMonthLabels(start, end, totalWeeks) {
  const labels = [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const current = new Date(start);
  current.setDate(1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (current <= endMonth) {
    const msSinceStart = (current.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    const col = Math.floor(msSinceStart / 7);
    if (col >= 0 && col < totalWeeks) {
      labels.push({ label: months[current.getMonth()], col });
    }
    current.setMonth(current.getMonth() + 1);
  }
  return labels;
}

async function main() {
  try {
    console.log(`Fetching LeetCode stats for "${USERNAME}"...`);
    const stats = await fetchStats();
    console.log("Solved:", stats.solved.total, "| Easy:", stats.solved.easy, "Medium:", stats.solved.medium, "Hard:", stats.solved.hard);
    console.log("Badges:", stats.badges.length);
    console.log("Calendar entries:", stats.calendar.submissionCalendar ? Object.keys(JSON.parse(stats.calendar.submissionCalendar)).length : 0);
    const svg = generateSVG(stats);
    fs.writeFileSync(SVG_PATH, svg, "utf-8");
    console.log("SVG saved to:", SVG_PATH);
    console.log(`File size: ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
