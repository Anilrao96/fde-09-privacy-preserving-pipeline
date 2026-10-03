import { createService } from './pipeline.mjs';

const server = createService({
  adminKey: process.env.PIPELINE_ADMIN_KEY || 'local-admin',
  secret: process.env.PIPELINE_HASH_SECRET || 'local-demo-secret-change-me',
  minimumGroupSize: Number(process.env.MINIMUM_GROUP_SIZE || 3)
});
const port = Number(process.env.PORT || 3009);
server.listen(port, '127.0.0.1', () => console.log(`Privacy pipeline listening on http://127.0.0.1:${port}`));
