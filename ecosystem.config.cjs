module.exports = {
  apps: [{
    name: 'polymarket-bot',
    script: 'node',
    args: '--import tsx server/index.ts',
    cwd: 'C:/polymarket-bot',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
  }],
};
