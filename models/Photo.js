const mongoose = require('mongoose');

const PhotoSchema = new mongoose.Schema({
  message_id: { type: String, required: true },
  attachment_id: { type: String, required: true, unique: true },
  is_approved: { type: Boolean, default: true },
  tags: { type: [String], default: [] },
  image_url: { type: String, required: true },
  thumb_url: { type: String },
  medium_url: { type: String },
  imgbb_id: { type: String },
  imgbb_delete_url: { type: String },
  username: { type: String, required: true },
  user_id: { type: String, required: true },
  caption: { type: String, default: '' },
  uploaded_at: { type: Date, default: Date.now },
  is_hidden: { type: Boolean, default: false },
  likes_count: { type: Number, default: 0 }
});

module.exports = mongoose.model('Photo', PhotoSchema);
