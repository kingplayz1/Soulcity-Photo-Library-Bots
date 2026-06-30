require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const Photo = require('./models/Photo');
const axios = require('axios');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- KOYEB HEALTH CHECK SERVER ---
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SoulCity Bot is Alive!\n');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Health check server listening on port ${PORT}`);
});
// ---------------------------------

// --- IMGBB UPLOAD HELPER ---
async function uploadToImgBB(url) {
  try {
    if (!process.env.IMGBB_API_KEY) {
      console.warn('IMGBB_API_KEY is missing. Falling back to Discord CDN.');
      return null;
    }

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}&image=${encodeURIComponent(url)}`);

    if (response.data && response.data.data) {
      return {
        url: response.data.data.url,
        thumb_url: response.data.data.thumb?.url,
        medium_url: response.data.data.medium?.url,
        delete_url: response.data.data.delete_url,
        id: response.data.data.id
      };
    }
    throw new Error('Invalid ImgBB response');
  } catch (error) {
    console.error(`ImgBB upload error:`, error.response?.data || error.message);
    return null;
  }
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}! Listening to channel: ${TARGET_CHANNEL_ID}`);
  
  // --- MIGRATION: Old Discord Photos to ImgBB (lightweight - skips if done) ---
  setTimeout(async () => {
    try {
      // Fast count check first - skip entirely if migration is already complete
      const unmigrated = await Photo.countDocuments({ $or: [{ imgbb_id: { $exists: false } }, { imgbb_id: null }] });
      if (unmigrated === 0) {
        console.log('✅ All photos already on ImgBB. No migration needed.');
        return;
      }

      console.log(`Found ${unmigrated} photos to migrate. Starting in background...`);
      const channel = await client.channels.fetch(TARGET_CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const oldPhotos = await Photo.find({ $or: [{ imgbb_id: { $exists: false } }, { imgbb_id: null }] });
      for (const photo of oldPhotos) {
        try {
          const message = await channel.messages.fetch(photo.message_id);
          const attachment = message.attachments.find(a => a.id === photo.attachment_id) || message.attachments.first();
          if (attachment) {
            const imgbb = await uploadToImgBB(attachment.url);
            if (imgbb) {
              if (!photo.attachment_id) photo.attachment_id = attachment.id;
              photo.image_url = imgbb.url;
              photo.thumb_url = imgbb.thumb_url;
              photo.medium_url = imgbb.medium_url;
              photo.imgbb_id = imgbb.id;
              photo.imgbb_delete_url = imgbb.delete_url;
              await photo.save();
              console.log(`✅ Migrated ${photo._id}`);
            }
          }
        } catch (e) {
          console.log(`⚠️ Skipped ${photo._id}: ${e.message}`);
        }
      }
      console.log('Migration complete.');
    } catch (err) {
      console.error('Migration error:', err.message);
    }
  }, 5000); // 5 second delay - well after startup
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== TARGET_CHANNEL_ID) return;

  if (message.attachments.size > 0) {
    const Setting = require('./models/Setting');
    const moderationSetting = await Setting.findOne({ key: 'moderation_enabled' });
    const isApprovedByDefault = moderationSetting ? !moderationSetting.value : true;

    const tags = message.content ? [...message.content.matchAll(/#(\w+)/g)].map(m => m[1].toLowerCase()) : [];

    for (const [id, attachment] of message.attachments) {
      if (attachment.contentType && attachment.contentType.startsWith('image/')) {
        try {
          console.log(`Processing image: ${attachment.name}`);
          const imgbb = await uploadToImgBB(attachment.url);
          
          const newPhoto = new Photo({
            message_id: message.id,
            attachment_id: attachment.id,
            image_url: imgbb ? imgbb.url : attachment.url,
            thumb_url: imgbb ? imgbb.thumb_url : undefined,
            medium_url: imgbb ? imgbb.medium_url : undefined,
            imgbb_id: imgbb ? imgbb.id : undefined,
            imgbb_delete_url: imgbb ? imgbb.delete_url : undefined,
            username: message.author.username,
            user_id: message.author.id,
            caption: message.content || '',
            tags: tags,
            uploaded_at: message.createdAt,
            is_approved: isApprovedByDefault
          });

          await newPhoto.save();
          console.log(`Saved photo from ${message.author.username} (ImgBB: ${!!imgbb})`);
          await message.react(isApprovedByDefault ? '✅' : '⏳');
          if (imgbb) await message.react('☁️');
          if (tags.length > 0) await message.react('🏷️');
        } catch (error) {
          console.error('Error saving photo:', error);
          if (error.code !== 11000) {
            await message.react('❌');
          }
        }
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
