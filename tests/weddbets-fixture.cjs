const dimensionsByRatio = {
  '16x9': [320, 180],
  '4x3': [320, 240],
  '3x4': [240, 320],
  '16x4': [320, 80],
}

function createWeddBetsFixture(requestUrl) {
  const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl, 'http://127.0.0.1')
  if (!url.pathname.startsWith('/view/')) return null
  const [width, height] = dimensionsByRatio[url.searchParams.get('ratio')] ?? dimensionsByRatio['16x9']
  const player = ['openvidu', 'ant', 'flash', 'ms', 'frame'].includes(url.searchParams.get('player'))
    ? url.searchParams.get('player')
    : 'openvidu'
  const late = url.searchParams.get('late') === '1'
  const empty = url.searchParams.get('fixture') === 'empty'
  const display = (...players) => players.includes(player) ? 'block' : 'none'
  const openviduVideo = late && player === 'openvidu' ? '' : '<video autoplay muted playsinline data-fixture-video="openvidu"></video>'
  return `<!doctype html><title>WeddBets video fixture</title>
    <style>
      html,body{margin:0;background:#000;overflow:hidden}
      #app.container-fluid{padding-right:15px;padding-left:15px;box-sizing:border-box}
      .row{display:flex;flex-wrap:wrap;margin-right:-15px;margin-left:-15px}
      .col-md-12{flex:0 0 100%;max-width:100%;padding-right:15px;padding-left:15px;box-sizing:border-box}
      video{width:100%;height:auto;object-fit:contain!important;object-position:left bottom!important;background:#103cb0!important}
    </style>
    <div id="app" class="container-fluid"><div class="app-shell"><div class="view-evento">
      <div class="row rowOpenvidu" style="display:${display('openvidu')}">
        <div class="col-md-12 text-center" style="padding:0"><div id="subscriber">${openviduVideo}</div></div>
      </div>
      <div class="row rowAnt" style="display:${display('ant')}"><div class="col-md-12" style="padding:0"><video id="remoteVideo" data-fixture-video="ant"></video></div></div>
      <div class="row rowFlash" style="display:${display('flash')}"><div class="col-md-12" style="padding:0"><div id="playFlash"><video id="flashPlayVideo" data-fixture-video="flash"></video></div></div></div>
      <div class="row rowMS" style="display:${display('ms', 'frame')}"><div class="col-md-12" style="padding:0">
        <video id="msPlayVideo" style="display:${display('ms')}" data-fixture-video="ms"></video>
        <video id="msPlayVideoBackup" style="display:none" data-fixture-video="ms-backup"></video>
        <video id="frameVideo" style="display:${display('frame')}" data-fixture-video="frame"></video>
      </div></div>
    </div></div><div class="notification-container"></div></div>
    <canvas hidden width="${width}" height="${height}"></canvas>
    <script>
      const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
      const player = ${JSON.stringify(player)};
      const late = ${JSON.stringify(late)};
      const empty = ${JSON.stringify(empty)};
      const selectors = {
        openvidu: '#subscriber video[data-fixture-video="openvidu"]',
        ant: '#remoteVideo',
        flash: '#flashPlayVideo',
        ms: '#msPlayVideo',
        frame: '#frameVideo',
      };
      const holders = { openvidu: '#subscriber', ant: '.rowAnt .col-md-12', flash: '#playFlash', ms: '.rowMS .col-md-12', frame: '.rowMS .col-md-12' };
      function draw() {
        context.fillStyle='#103cb0'; context.fillRect(0,0,${width},${height});
        context.strokeStyle='#fff'; context.lineWidth=Math.max(2, Math.round(${width}/80)); context.strokeRect(2,2,${width}-4,${height}-4);
        context.fillStyle='#fff'; context.font='${Math.max(14, Math.round(width / 12))}px sans-serif'; context.fillText('TOP',8,${Math.max(24, Math.round(height / 8))});
        context.fillText('PLACAR',8,${Math.max(24, height - 12)});
      }
      function mountVideo() {
        let video = document.querySelector(selectors[player]);
        if (!video) {
          video = document.createElement('video');
          video.autoplay = true; video.muted = true; video.playsInline = true;
          video.dataset.fixtureVideo = player;
          document.querySelector(holders[player]).append(video);
        }
        video.srcObject=canvas.captureStream(10); video.play();
      }
      draw(); setInterval(draw,100);
      if (empty) document.querySelectorAll('video').forEach((video) => video.remove());
      else setTimeout(mountVideo, late ? 150 : 0);
    </script>`
}

module.exports = { createWeddBetsFixture }
