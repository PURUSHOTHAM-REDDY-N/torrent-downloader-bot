import dotenv from "dotenv";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import path from "path";
import WebTorrent from "webtorrent";
dotenv.config();

const token = process.env.TELEGRAM_TOKEN || "YOUR_TELEGRAM_BOT_TOKEN";
const bot = new TelegramBot(token, { polling: true });
const client = new WebTorrent();

bot.onText(/magnet:\?xt=urn:btih:[a-zA-Z0-9]+/, async (msg, match) => {
  const chatId = msg.chat.id;
  const magnetLink = match?.[0];

  if (!magnetLink) {
    bot.sendMessage(chatId, "Invalid magnet link.");
    return;
  }

  const statusMessage = await bot.sendMessage(
    chatId,
    "⏳ Getting torrent info ..."
  );
  const messageId = statusMessage.message_id;

  const torrent = client.add(magnetLink, { path: "./downloads" });

  let intervalId;

  let lastProgress; // Track the last progress percentage

  intervalId = setInterval(() => {
    const progress = Math.round(torrent.progress * 100);
    if (progress !== lastProgress) {
      lastProgress = progress;

      bot
        .editMessageText(`📥 Downloading... ${progress}%`, {
          chat_id: chatId,
          message_id: messageId,
        })
        .catch((err) => {
          console.error("Failed to edit message:", err.message);
        });
    }
  }, 5000);

  torrent.on("done", async () => {
    clearInterval(intervalId);
    await bot.editMessageText("✅ Download complete!", {
      chat_id: chatId,
      message_id: messageId,
    });

    for (const file of torrent.files) {
      const ext = path.extname(file.name).toLowerCase();
      const isVideo = [".mp4", ".mkv", ".avi", ".mov", ".webm"].includes(ext);

      if (!isVideo) {
        continue; // Skip non-video files
      }

      const filePath = path.join("./downloads", file.path);
      const fileSize = fs.statSync(filePath).size;

      if (fileSize > 49 * 1024 * 1024) {
        await bot.sendMessage(
          chatId,
          `⚠️ Video ${file.name} is too large for Telegram (>50MB).`
        );
        continue;
      }

      await bot.sendMessage(chatId, `📤 Uploading: ${file.name}`);
      await bot.sendDocument(
        chatId,
        filePath,
        {},
        {
          filename: file.name,
          contentType: "video/mp4", // This can be generic unless you want to guess actual type
        }
      );

      fs.unlinkSync(filePath);
    }

    torrent.destroy();
  });

  torrent.on("error", (err) => {
    clearInterval(intervalId);
    bot.sendMessage(chatId, `❌ Torrent error: ${err.message}`);
  });
});
