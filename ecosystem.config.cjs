module.exports = {
  apps: [{
    name: 'polymarket-bot',
    script: 'node',
    args: '--import tsx server/index.ts',
    cwd: 'C:\\polymarket-bot',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    // Crash recovery
    autorestart: true,
    max_restarts: 50,
    restart_delay: 5000,
    // Memory limit (3GB VPS)
    max_memory_restart: '2G',
    // Logs
    log_file: 'data/bot.log',
    error_file: 'data/error.log',
    out_file: 'data/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    // Calisma suresi
    min_uptime: 10000,
  }],
};
