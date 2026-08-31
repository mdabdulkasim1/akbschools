module.exports = {
  apps: [
    {
      name: 'akb-school',
      script: 'server.js',
      cwd: '/home/akbgroups/public_html/akbschools.akbgroups.com',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 3021,
        MYSQL_HOST: 'localhost',
        MYSQL_USER: 'akbgroups_user_sch',
        MYSQL_PASSWORD: 'bka@6202#db',
        MYSQL_DATABASE: 'akbgroups_akbschools',
        MYSQL_PORT: 3306
      }
    }
  ]
};
