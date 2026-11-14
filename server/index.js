import { loadEnvironment, startApplication } from './runtime.js';
loadEnvironment();
const {
  app,
  db,
  config: { port, publicUrl },
} = await startApplication();
const server = app.listen(port, process.env.HOST || '127.0.0.1', async () =>
  console.log(
    `Wedding API: http://localhost:${port}\nWebsite / QR base: ${publicUrl}\n${(await db.prepare('SELECT id FROM admins LIMIT 1').get()) ? '' : 'Buat akun admin: npm run admin:create'}`,
  ),
);
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
  db.close();
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
