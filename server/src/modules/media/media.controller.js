import { sendSuccess } from '../../shared/utils/response.js';

export function createMediaController(media) {
  return { async upload(req, res) {
    const { kind, targetId } = req.validated.params;
    const data = await media.upload(req.context.store, req.auth, kind, targetId, req.body, req.get('Content-Type'));
    sendSuccess(res, { status: 201, data });
  } };
}
