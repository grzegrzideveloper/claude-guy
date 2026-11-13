// Off-screen render of the real UI to a PNG, without spawning claude or touching saved tabs.
// Usage: npm run shot -- out.png [width] [height]     (SHOT_JS="..." runs in the page before capture)
const path = require('path');

const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
const out = path.resolve(args[0] || 'shot.png');
const width = parseInt(args[1], 10) || 1400;
const height = parseInt(args[2], 10) || 900;

process.env.CLAUDE_GUI_HEADLESS = '1';
process.env.CLAUDE_GUI_SHOT = JSON.stringify({ out, width, height });
require('../main.js');
