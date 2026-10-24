/** Self-contained page for the "Monitor de lances" window; loaded as a data: URL. */
export const monitorHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Monitor de lances</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0f14; color: #d7e0ea; font: 13px/1.5 Consolas, 'Cascadia Mono', monospace; display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; gap: 12px; align-items: center; padding: 10px 14px; background: #121922; border-bottom: 1px solid #243040; font-family: 'Segoe UI', sans-serif; }
  header strong { font-size: 14px; }
  header span { color: #7f90a4; font-size: 12px; flex: 1; }
  button { background: #1c2735; color: #d7e0ea; border: 1px solid #2d3d52; border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; font-family: 'Segoe UI', sans-serif; }
  button:hover { background: #26354a; }
  #log { flex: 1; overflow: auto; padding: 8px 14px; margin: 0; white-space: pre-wrap; word-break: break-word; }
  .line { padding: 1px 0; }
  .time { color: #5f7186; margin-right: 8px; }
  .goal { color: #b8ff4d; font-weight: 600; }
  .penalty { color: #ffb14d; }
  .red { color: #ff6b6b; }
  .yellow { color: #ffd84d; }
  .warn { color: #ff9d6b; }
  .source { display: inline-block; min-width: 9.5em; margin-right: 8px; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 600; text-align: center; font-family: 'Segoe UI', sans-serif; }
  .source--wh { background: #12324a; color: #7cc4ff; }
  .source--365 { background: #3a2a10; color: #ffc46b; }
</style></head>
<body>
<header><strong>Monitor de lances</strong><span id="status">aguardando…</span><button id="clear" type="button">Limpar tela</button></header>
<div id="log" role="log" aria-live="polite"></div>
<script>
  const log = document.getElementById('log')
  const status = document.getElementById('status')
  let count = 0
  function cls(text) {
    if (/ GOAL /.test(text) || /^\\[.*\\] GOAL/.test(text)) return 'goal'
    if (/PENALTY/.test(text)) return 'penalty'
    if (/RED /.test(text)) return 'red'
    if (/YELLOW/.test(text)) return 'yellow'
    if (/reconectando|ausente|desconectado|falha/.test(text)) return 'warn'
    return ''
  }
  function add(line) {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 24
    const row = document.createElement('div')
    row.className = 'line ' + cls(line.text)
    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = line.time
    row.append(time)
    if (line.source === 'wh' || line.source === '365') {
      const source = document.createElement('span')
      source.className = 'source source--' + line.source
      source.textContent = line.source === 'wh' ? 'William Hill' : '365Scores API'
      row.append(source)
    }
    row.append(document.createTextNode(line.text))
    log.append(row)
    while (log.childElementCount > 1000) log.firstElementChild.remove()
    count += 1
    status.textContent = 'engine ativa · última linha às ' + line.time
    if (stick) log.scrollTop = log.scrollHeight
  }
  window.quadraMonitor.getBacklog().then((lines) => { lines.forEach(add); if (!lines.length) status.textContent = 'engine ativa · nenhum painel vinculado ainda' })
  window.quadraMonitor.onLine(add)
  document.getElementById('clear').addEventListener('click', () => { log.textContent = '' })
</script></body></html>`
