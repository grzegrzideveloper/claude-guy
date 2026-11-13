// Runtime selection. Only `native` exists for now; `wsl` is planned (PLAN.md, "Później").
const native = require('./native');

function getRuntime(name = 'native') {
  if (name !== 'native') console.warn(`runtime "${name}" not available, using native`);
  return native;
}

module.exports = { getRuntime };
