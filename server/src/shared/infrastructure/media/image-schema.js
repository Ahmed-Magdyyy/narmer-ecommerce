import mongoose from 'mongoose';

// Persist only server-created image references, never client URLs or storage credentials.
export const imageSchema = new mongoose.Schema({
  id: { type: String, required: true, match: /^[a-f0-9]{24}$/ },
  url: { type: String, required: true },
  width: { type: Number, required: true, min: 1, max: 1600 },
  height: { type: Number, required: true, min: 1, max: 1600 },
}, { _id: false, strict: 'throw' });
