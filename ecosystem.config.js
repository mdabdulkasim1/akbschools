module.exports = {
  apps: [
    {
      name: 'akb-school',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3021
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3021
      }
    }
  ]
};
