import { Router } from 'express';

export function createApiRouter({ b2c = Router(), b2b = Router(), adminB2c = Router(), adminB2b = Router() } = {}) {
  const router = Router();
  for (const [path, store, routes] of [
    ['/b2c', 'b2c', b2c], ['/b2b', 'b2b', b2b],
    ['/admin/b2c', 'b2c', adminB2c], ['/admin/b2b', 'b2b', adminB2b],
  ]) {
    router.use(path, (req, res, next) => {
      req.context = Object.freeze({ ...req.context, store });
      next();
    }, routes);
  }
  return router;
}
