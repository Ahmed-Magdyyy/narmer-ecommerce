import mongoose from 'mongoose';

export async function connectDatabase(config) {
  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
  });
}

export const isDatabaseReady = () => mongoose.connection.readyState === 1;
export const disconnectDatabase = () => mongoose.disconnect();
