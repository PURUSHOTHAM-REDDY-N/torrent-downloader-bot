import { formatBytes } from "bytes-formatter";
import dotenv from "dotenv";
import fs from "fs";
import throttle from "lodash.throttle";
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
    bot.sendMessage(chatId, `⛔ Invalid magnet link
      \nPlease send a valid magnet link.`);
    return;
  }

  const statusMessage = await bot.sendMessage(
    chatId,
    "⏳ Getting torrent info ..."
  );
  const messageId = statusMessage.message_id;

  const torrent = client.add(magnetLink, { path: "./downloads", announce: [
    "wss://tracker.btorrent.xyz:443",
  ] });

  let lastProgress; // Track the last progress percentage

  const updateProgressMessage = throttle((progress) => {
    bot
      .editMessageText(
        `${torrent.name} \n\n
        📥 Downloading... ${progress}% \n
        ${torrent.length ? `Total Size: ${formatBytes(torrent.length)}` : ""} \n
        ${torrent.downloaded ? `Downloaded: ${formatBytes(torrent.downloaded)}` : ""} \n
    Download Speed ${formatBytes(torrent.downloadSpeed)}/sec`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      )
      .catch((err) => {
        console.error("Failed to edit message:", err.message);
      });
  }, 3000); // at most once every 5s

  torrent.on("done", async () => {
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

  torrent.on("download", () => {
    const progress = Math.round(torrent.progress * 100);
    if (progress !== lastProgress) {
      lastProgress = progress;
      updateProgressMessage(progress);
    }
  });

  torrent.on("ready", () => {
    console.log("Torrent is ready");
  });

  torrent.on("infoHash", () => {
    console.log("Torrent info hash",torrent.infoHash);
  });

  torrent.on('metadata', () => {
    console.log('Torrent metadata', formatBytes(torrent.length));
    // console.log('Torrent metadata', torrent.files);
  })

  // torrent.on("wire", () => {
  //   console.log("Torrent wire");
  // });

  torrent.on("error", (err) => {
    bot.sendMessage(chatId, `❌ Torrent error: ${err.message}`);
  });
});
