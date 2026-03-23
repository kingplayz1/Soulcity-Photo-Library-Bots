require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const Photo = require('./models/Photo');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- KOYEB HEALTH CHECK SERVER ---
const http = require('http');
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('SoulCity Bot is Alive!\n');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Health check server listening on port ${PORT}`);
});
// ---------------------------------

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}! Listening to channel: ${TARGET_CHANNEL_ID}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channelId !== TARGET_CHANNEL_ID) return;

  if (message.attachments.size > 0) {
    // Get moderation setting
    const Setting = require('./models/Setting');
    const moderationSetting = await Setting.findOne({ key: 'moderation_enabled' });
    const isApprovedByDefault = moderationSetting ? !moderationSetting.value : true;

    // Extract hashtags from content
    const tags = message.content ? [...message.content.matchAll(/#(\w+)/g)].map(m => m[1].toLowerCase()) : [];

    message.attachments.forEach(async (attachment) => {
      if (attachment.contentType && attachment.contentType.startsWith('image/')) {
        try {
          const newPhoto = new Photo({
            message_id: message.id,
            attachment_id: attachment.id,
            image_url: attachment.url,
            username: message.author.username,
            user_id: message.author.id,
            caption: message.content || '',
            tags: tags,
            uploaded_at: message.createdAt,
            is_approved: isApprovedByDefault
          });
          await newPhoto.save();
          console.log(`Saved photo from ${message.author.username} with tags: ${tags.join(', ')} (Approved: ${isApprovedByDefault})`);
          await message.react(isApprovedByDefault ? '✅' : '⏳');
          if (tags.length > 0) await message.react('🏷️');
        } catch (error) {
          console.error('Error saving photo:', error);
          if (error.code !== 11000) {
            await message.react('❌');
          }
        }
      }
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
