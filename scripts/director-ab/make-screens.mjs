// Draws five product-UI mockups (1280x800) so the director test has real screenshots to read. Run: node make-screens.mjs
import sharp from "sharp";
const W = 1280, H = 800;
const font = "font-family='Inter, Helvetica, Arial, sans-serif'";
const frame = (body, title) => `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'><rect width='${W}' height='${H}' fill='#f4f6fb'/>
<rect width='${W}' height='56' fill='#ffffff'/><rect y='56' width='${W}' height='1' fill='#e3e7ef'/><circle cx='28' cy='28' r='10' fill='#4f46e5'/><text x='48' y='34' ${font} font-size='18' font-weight='700' fill='#111827'>Tidyflow</text><text x='${W - 190}' y='34' ${font} font-size='14' fill='#6b7280'>${title}</text><circle cx='${W - 40}' cy='28' r='14' fill='#c7d2fe'/>${body}</svg>`;
const side = (active) => `<rect y='57' width='220' height='${H - 57}' fill='#ffffff'/><rect x='220' y='57' width='1' height='${H - 57}' fill='#e3e7ef'/>${["Dashboard", "My tasks", "Team", "Reports", "Settings"].map((n, i) => `<rect x='12' y='${80 + i * 46}' width='196' height='38' rx='8' fill='${n === active ? "#eef2ff" : "none"}'/><text x='32' y='${104 + i * 46}' ${font} font-size='15' font-weight='${n === active ? 700 : 500}' fill='${n === active ? "#4338ca" : "#374151"}'>${n}</text>`).join("")}`;
const card = (x, y, w, h, label, value, color) => `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='14' fill='#ffffff' stroke='#e3e7ef'/><text x='${x + 20}' y='${y + 32}' ${font} font-size='13' fill='#6b7280'>${label}</text><text x='${x + 20}' y='${y + 74}' ${font} font-size='34' font-weight='700' fill='${color}'>${value}</text>`;
const bars = (x, y, items, max, color) => items.map(([n, v], i) => `<text x='${x}' y='${y + i * 44 + 18}' ${font} font-size='14' fill='#374151'>${n}</text><rect x='${x + 90}' y='${y + i * 44}' width='${(v / max) * 420}' height='26' rx='6' fill='${color}'/><text x='${x + 100 + (v / max) * 420}' y='${y + i * 44 + 18}' ${font} font-size='13' fill='#111827'>${v}</text>`).join("");

const screens = {
  "dashboard.png": frame(`${side("Dashboard")}<text x='252' y='110' ${font} font-size='26' font-weight='700' fill='#111827'>Team workload</text>
${card(252, 132, 220, 100, "Open tasks", "12", "#4338ca")}${card(488, 132, 220, 100, "Due today", "5", "#dc2626")}${card(724, 132, 220, 100, "Done this week", "31", "#059669")}${card(960, 132, 260, 100, "Blocked", "2", "#d97706")}
<rect x='252' y='256' width='968' height='500' rx='14' fill='#ffffff' stroke='#e3e7ef'/><text x='276' y='292' ${font} font-size='16' font-weight='600' fill='#111827'>Tasks per teammate</text>
${bars(276, 320, [["Maya", 9], ["Jonas", 7], ["Priya", 5], ["Leo", 3], ["Sam", 2]], 9, "#6366f1")}
<rect x='1040' y='700' width='160' height='40' rx='10' fill='#4f46e5'/><text x='1066' y='726' ${font} font-size='14' font-weight='600' fill='#ffffff'>+ New task</text>`, "Dashboard"),
  "invite.png": frame(`${side("Team")}<text x='252' y='110' ${font} font-size='26' font-weight='700' fill='#111827'>Team</text>
<rect x='252' y='140' width='968' height='60' rx='12' fill='#ffffff' stroke='#e3e7ef'/><text x='276' y='176' ${font} font-size='15' fill='#374151'>Maya Chen · Admin</text><text x='276' y='196' ${font} font-size='12' fill='#9ca3af'>maya@acme.co</text>
<rect x='0' y='57' width='${W}' height='${H - 57}' fill='#111827' opacity='0.45'/>
<rect x='430' y='200' width='420' height='360' rx='18' fill='#ffffff'/><text x='462' y='252' ${font} font-size='22' font-weight='700' fill='#111827'>Invite a teammate</text>
<text x='462' y='292' ${font} font-size='13' fill='#6b7280'>Email address</text><rect x='462' y='302' width='356' height='44' rx='10' fill='#f9fafb' stroke='#d1d5db'/><text x='478' y='330' ${font} font-size='15' fill='#111827'>sam@acme.co</text>
<text x='462' y='378' ${font} font-size='13' fill='#6b7280'>Role</text><rect x='462' y='388' width='356' height='44' rx='10' fill='#f9fafb' stroke='#d1d5db'/><text x='478' y='416' ${font} font-size='15' fill='#111827'>Member</text>
<rect x='462' y='470' width='356' height='48' rx='12' fill='#4f46e5'/><text x='576' y='501' ${font} font-size='16' font-weight='700' fill='#ffffff'>Send invite</text>`, "Team"),
  "report.png": frame(`${side("Reports")}<text x='252' y='110' ${font} font-size='26' font-weight='700' fill='#111827'>Weekly report</text>
<rect x='252' y='132' width='968' height='330' rx='14' fill='#ffffff' stroke='#e3e7ef'/><text x='276' y='168' ${font} font-size='16' font-weight='600' fill='#111827'>Tasks completed per day</text>
<polyline points='300,420 400,380 500,395 600,330 700,300 800,250 900,230 1000,205 1160,190' fill='none' stroke='#4f46e5' stroke-width='4'/>${[300, 400, 500, 600, 700, 800, 900, 1000, 1160].map((x, i) => `<circle cx='${x}' cy='${[420, 380, 395, 330, 300, 250, 230, 205, 190][i]}' r='5' fill='#4f46e5'/>`).join("")}
<text x='1100' y='176' ${font} font-size='13' font-weight='700' fill='#059669'>+38% vs last week</text>
<rect x='252' y='486' width='968' height='270' rx='14' fill='#ffffff' stroke='#e3e7ef'/>${["Task", "Owner", "Status"].map((h, i) => `<text x='${276 + i * 300}' y='520' ${font} font-size='13' font-weight='700' fill='#6b7280'>${h}</text>`).join("")}
${[["Ship pricing page", "Maya", "Done"], ["Fix invite email", "Jonas", "In progress"], ["Q4 roadmap", "Priya", "Blocked"]].map((r, i) => r.map((c, j) => `<text x='${276 + j * 300}' y='${556 + i * 48}' ${font} font-size='15' fill='#111827'>${c}</text>`).join("")).join("")}`, "Reports"),
  "api-flow.png": frame(`<text x='60' y='110' ${font} font-size='26' font-weight='700' fill='#111827'>Request flow</text>
${[["Client", 60], ["API gateway", 360], ["Auth service", 660], ["Database", 960]].map(([n, x]) => `<rect x='${x}' y='300' width='220' height='120' rx='16' fill='#ffffff' stroke='#6366f1' stroke-width='2'/><text x='${x + 110}' y='368' text-anchor='middle' ${font} font-size='20' font-weight='700' fill='#111827'>${n}</text>`).join("")}
${[280, 580, 880].map((x) => `<line x1='${x}' y1='360' x2='${x + 80}' y2='360' stroke='#4f46e5' stroke-width='4'/><polygon points='${x + 80},350 ${x + 100},360 ${x + 80},370' fill='#4f46e5'/>`).join("")}
<text x='320' y='340' ${font} font-size='13' fill='#6b7280'>GET /orders</text><text x='640' y='340' ${font} font-size='13' fill='#6b7280'>verify token</text><text x='940' y='340' ${font} font-size='13' fill='#6b7280'>SELECT</text><text x='60' y='520' ${font} font-size='16' fill='#374151'>200 OK in 84 ms</text>`, "Architecture"),
  "revenue.png": frame(`${side("Reports")}<text x='252' y='110' ${font} font-size='26' font-weight='700' fill='#111827'>Revenue by quarter</text>
<rect x='252' y='132' width='968' height='600' rx='14' fill='#ffffff' stroke='#e3e7ef'/>
${[["Q1", 1.2], ["Q2", 1.5], ["Q3", 1.9], ["Q4", 2.4]].map(([q, v], i) => `<rect x='${340 + i * 220}' y='${680 - v * 200}' width='120' height='${v * 200}' rx='8' fill='${q === "Q4" ? "#4f46e5" : "#c7d2fe"}'/><text x='${400 + i * 220}' y='712' text-anchor='middle' ${font} font-size='16' fill='#374151'>${q}</text><text x='${400 + i * 220}' y='${668 - v * 200}' text-anchor='middle' ${font} font-size='18' font-weight='700' fill='#111827'>$${v}M</text>`).join("")}`, "Reports")
};
for (const [name, svg] of Object.entries(screens)) await sharp(Buffer.from(svg)).png().toFile(new URL(`./screens/${name}`, import.meta.url).pathname);
console.log("wrote", Object.keys(screens).join(", "));
