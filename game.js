// game.js — 微信小游戏入口
try {
  require('./dist/game.js');
} catch (e) {
  // 如果加载失败, 在画布上显示错误信息
  const canvas = wx.createCanvas();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1B5E20';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#FF5252';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  const msg = e.message || String(e);
  const lines = msg.split('\n');
  let y = 40;
  for (const line of lines) {
    ctx.fillText(line, 20, y);
    y += 20;
  }
  // 同时输出到 stack
  if (e.stack) {
    ctx.fillStyle = '#FFFFFF';
    const stackLines = e.stack.split('\n').slice(0, 15);
    for (const line of stackLines) {
      ctx.fillText(line, 20, y);
      y += 18;
    }
  }
  console.error('Game load error:', e);
}
