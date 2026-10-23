import mongoose from 'mongoose';
import { AppError } from '../errors/app-error.js';

export async function runTransaction(work) {
  const session = await mongoose.connection.startSession();
  try {
    // Repositories return plain objects; no Mongoose document-reset tracking is needed on abort.
    return await session.withTransaction(work, {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error.code === 20 || error.codeName === 'IllegalOperation') {
      throw new AppError(503, 'TRANSACTIONS_REQUIRED');
    }
    throw error;
  } finally { await session.endSession(); }
}
